import { createHash, randomBytes, scrypt as deriveKey, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import express from 'express'
import mongoose from 'mongoose'
import { isImageUrl, Recipe, Session, User } from './models.js'

const app = express()
const scrypt = promisify(deriveKey)
const sessionDuration = 7 * 24 * 60 * 60 * 1000
const cookieOptions = {
  httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/'
}
const tokenHash = token => createHash('sha256').update(token).digest('hex')
const route = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
const publicUser = user => ({ id: String(user._id), name: user.name })
const listeners = new Set()

app.disable('x-powered-by')
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})
app.use(express.json({ limit: '32kb' }))

function sessionToken(req) {
  const match = req.headers.cookie?.match(/(?:^|;\s*)recipe_session=([a-f0-9]{64})(?:;|$)/)
  return match?.[1]
}

async function startSession(req, res, user) {
  const previous = sessionToken(req)
  if (previous) await Session.deleteOne({ tokenHash: tokenHash(previous) })
  const token = randomBytes(32).toString('hex')
  await Session.create({
    tokenHash: tokenHash(token), user: user._id, expiresAt: new Date(Date.now() + sessionDuration)
  })
  res.cookie('recipe_session', token, { ...cookieOptions, maxAge: sessionDuration })
}

const readSession = route(async (req, res, next) => {
  const token = sessionToken(req)
  if (token) {
    const session = await Session.findOne({
      tokenHash: tokenHash(token), expiresAt: { $gt: new Date() }
    }).populate('user', 'name').lean()
    req.user = session?.user
  }
  next()
})

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Log in to continue.' })
  next()
}

app.post('/api/auth/signup', route(async (req, res) => {
  const { name, username, password } = req.body ?? {}
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 60 ||
      typeof username !== 'string' || !/^[a-z0-9_]{3,30}$/i.test(username.trim()) ||
      typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'Enter a name, a username with 3–30 letters, numbers, or underscores, and a password of 8–128 characters.' })
  }
  const salt = randomBytes(16).toString('hex')
  const key = await scrypt(password, salt, 64)
  const user = await User.create({ name, username, passwordHash: salt + ':' + key.toString('hex') })
  await startSession(req, res, user)
  res.status(201).json(publicUser(user))
}))

app.post('/api/auth/login', route(async (req, res) => {
  const { username, password } = req.body ?? {}
  const invalid = () => res.status(401).json({ error: 'Username or password is incorrect.' })
  if (typeof username !== 'string' || !username.trim() || username.trim().length > 254 || typeof password !== 'string' || password.length > 128) {
    return invalid()
  }
  const user = await User.findOne({ username: username.trim().toLowerCase() }).lean()
  const [salt, hash] = user?.passwordHash.split(':') ?? ['0'.repeat(32), '0'.repeat(128)]
  const key = await scrypt(password, salt, 64)
  if (!timingSafeEqual(key, Buffer.from(hash, 'hex')) || !user) return invalid()
  await startSession(req, res, user)
  res.json(publicUser(user))
}))

app.get('/api/auth/me', readSession, (req, res) => res.json(req.user ? publicUser(req.user) : null))
app.delete('/api/auth/session', route(async (req, res) => {
  const token = sessionToken(req)
  if (token) await Session.deleteOne({ tokenHash: tokenHash(token) })
  res.clearCookie('recipe_session', cookieOptions).sendStatus(204)
}))

app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' })
  res.flushHeaders()
  res.write(': connected\n\n')
  listeners.add(res)
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25000)
  res.on('close', () => {
    clearInterval(heartbeat)
    listeners.delete(res)
  })
})

function announce() {
  for (const listener of listeners) listener.write('event: recipes\ndata: changed\n\n')
}

function clientRecipe(recipe, user) {
  return {
    id: String(recipe._id),
    title: recipe.title,
    ingredients: recipe.ingredients,
    imageUrl: recipe.imageUrl,
    author: publicUser(recipe.author),
    createdAt: recipe.createdAt,
    likeCount: recipe.likes.length,
    liked: Boolean(user && recipe.likes.some(id => id.equals(user._id)))
  }
}

function recipeInput(req, res, next) {
  const { title, ingredients, imageUrl } = req.body ?? {}
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 100 ||
      !Array.isArray(ingredients) || ingredients.length < 1 || ingredients.length > 40 ||
      ingredients.some(item => typeof item !== 'string' || !item.trim() || item.trim().length > 200) ||
      typeof imageUrl !== 'string' || imageUrl.trim().length > 2048 || !isImageUrl(imageUrl.trim())) {
    return res.status(400).json({ error: 'Enter a title, 1–40 ingredients, and a valid HTTP(S) image URL.' })
  }
  req.recipeInput = { title: title.trim(), ingredients: ingredients.map(item => item.trim()), imageUrl: imageUrl.trim() }
  next()
}

app.param('id', (req, res, next, id) => {
  if (!mongoose.isObjectIdOrHexString(id)) return res.status(404).json({ error: 'Recipe not found.' })
  next()
})

app.get('/api/recipes', readSession, route(async (req, res) => {
  const recipes = await Recipe.find().sort({ createdAt: -1 }).populate('author', 'name').lean()
  res.json(recipes.map(recipe => clientRecipe(recipe, req.user)))
}))

app.get('/api/recipes/:id', readSession, route(async (req, res) => {
  const recipe = await Recipe.findById(req.params.id).populate('author', 'name').lean()
  if (!recipe) return res.status(404).json({ error: 'Recipe not found.' })
  res.json(clientRecipe(recipe, req.user))
}))

app.post('/api/recipes', readSession, requireUser, recipeInput, route(async (req, res) => {
  const recipe = await Recipe.create({ ...req.recipeInput, author: req.user._id })
  await recipe.populate('author', 'name')
  announce()
  res.status(201).json(clientRecipe(recipe, req.user))
}))

app.put('/api/recipes/:id', readSession, requireUser, recipeInput, route(async (req, res) => {
  const recipe = await Recipe.findOneAndUpdate(
    { _id: req.params.id, author: req.user._id }, req.recipeInput, { new: true, runValidators: true }
  ).populate('author', 'name')
  if (!recipe) return res.status(404).json({ error: 'Recipe not found in your collection.' })
  announce()
  res.json(clientRecipe(recipe, req.user))
}))

app.delete('/api/recipes/:id', readSession, requireUser, route(async (req, res) => {
  const result = await Recipe.deleteOne({ _id: req.params.id, author: req.user._id })
  if (!result.deletedCount) return res.status(404).json({ error: 'Recipe not found in your collection.' })
  announce()
  res.sendStatus(204)
}))

for (const [method, operation] of [['put', '$addToSet'], ['delete', '$pull']]) {
  app[method]('/api/recipes/:id/like', readSession, requireUser, route(async (req, res) => {
    const recipe = await Recipe.findOneAndUpdate(
      { _id: req.params.id, author: { $ne: req.user._id } },
      { [operation]: { likes: req.user._id } },
      { new: true }
    ).populate('author', 'name')
    if (!recipe) return res.status(404).json({ error: 'Only recipes shared by other cooks can be liked.' })
    announce()
    res.json(clientRecipe(recipe, req.user))
  }))
}

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }))
const dist = fileURLToPath(new URL('./dist/', import.meta.url))
if (existsSync(dist)) app.use(express.static(dist))
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error)
  if (error.code === 11000) return res.status(409).json({ error: 'That username is already taken.' })
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' })
  if (error.type === 'entity.parse.failed' || error.name === 'ValidationError') {
    return res.status(400).json({ error: 'Check the submitted fields and try again.' })
  }
  console.error(error)
  res.status(500).json({ error: 'Something went wrong. Try again.' })
})

try {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/recipe_exchange', {
    serverSelectionTimeoutMS: 5000
  })
  await Promise.all([User.init(), Session.init(), Recipe.init()])
  // Preserve the sign-in identifier for accounts created before usernames.
  try {
    await User.collection.dropIndex('email_1')
  } catch (error) {
    if (error.code !== 27) throw error
  }
  await User.collection.updateMany(
    { username: { $exists: false }, email: { $type: 'string' } },
    { $rename: { email: 'username' } }
  )
  const port = Number(process.env.PORT || 4100)
  app.listen(port, () => console.log('Recipe Exchange listening on http://localhost:' + port))
} catch (error) {
  console.error('Could not start Recipe Exchange:', error.message)
  process.exit(1)
}
