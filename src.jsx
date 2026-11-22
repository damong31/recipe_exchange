import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch('/api' + path, {
    method,
    ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  })
  if (response.status === 204) return
  const data = await response.json().catch(() => null)
  if (!response.ok || (data === null && path !== '/auth/me')) {
    throw new Error(data?.error || 'Unable to reach Recipe Exchange. Try again.')
  }
  return data
}

function Modal({ title, close, children }) {
  const dialog = useRef(null)
  useEffect(() => { dialog.current.showModal() }, [])
  return <dialog ref={dialog} aria-labelledby="dialog-title" onCancel={event => {
    event.preventDefault()
    close()
  }}>
    <div className="dialog-heading">
      <h2 id="dialog-title">{title}</h2>
      <button type="button" className="close" aria-label="Close dialog" onClick={close}>×</button>
    </div>
    {children}
  </dialog>
}

function RecipeForm({ recipe, save, disabled = false }) {
  const [title, setTitle] = useState(recipe?.title ?? '')
  const [ingredients, setIngredients] = useState(recipe?.ingredients.join('\n') ?? '')
  const [imageUrl, setImageUrl] = useState(recipe?.imageUrl ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const canSubmit = Boolean(title.trim() && ingredients.trim() && imageUrl.trim())

  async function submit(event) {
    event.preventDefault()
    if (disabled || busy || !canSubmit) return
    setError('')
    setBusy(true)
    try {
      await save({
        title,
        ingredients: ingredients.split(/\r?\n/).map(item => item.trim()).filter(Boolean),
        imageUrl
      })
      if (!recipe) {
        setTitle('')
        setIngredients('')
        setImageUrl('')
      }
    } catch (error) {
      setError(error.message)
    } finally {
      setBusy(false)
    }
  }

  return <form className="recipe-form" onSubmit={submit}>
    <fieldset disabled={disabled || busy}>
      <label>Recipe title<input name="title" required maxLength={100}
        value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>Ingredients <span className="hint">One ingredient per line</span>
        <textarea name="ingredients" required rows={3} maxLength={8200}
          value={ingredients} onChange={event => setIngredients(event.target.value)} />
      </label>
      <label>Image URL<input name="imageUrl" type="url" required maxLength={2048}
        value={imageUrl} onChange={event => setImageUrl(event.target.value)} /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={!canSubmit}>
        {busy ? 'Saving…' : recipe ? 'Save changes' : 'Create recipe'}
      </button>
    </fieldset>
  </form>
}

function AuthForm({ mode, submit, changeMode }) {
  const signup = mode === 'signup'
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function handleSubmit(event) {
    event.preventDefault()
    const data = Object.fromEntries(new FormData(event.currentTarget))
    setError('')
    setBusy(true)
    try {
      await submit(data)
    } catch (error) {
      setError(error.message)
      setBusy(false)
    }
  }
  return <form onSubmit={handleSubmit}>
    {signup && <label>Name<input name="name" autoComplete="name" required maxLength={60} /></label>}
    <label>Username<input name="username" autoComplete="username" required
      autoCapitalize="none" spellCheck={false} maxLength={signup ? 30 : 254}
      pattern={signup ? '[A-Za-z0-9_]{3,30}' : undefined}
      title={signup ? 'Use 3–30 letters, numbers, or underscores.' : undefined} /></label>
    <label>Password<input name="password" type="password" autoComplete={signup ? 'new-password' : 'current-password'}
      required minLength={signup ? 8 : undefined} maxLength={128} /></label>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="primary" disabled={busy}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Log in'}</button>
    <button className="text-button" type="button" disabled={busy} onClick={changeMode}>
      {signup ? 'Already have an account? Log in' : 'Sign up'}
    </button>
  </form>
}

function RecipeImage({ recipe }) {
  const [failed, setFailed] = useState(false)
  return failed
    ? <div className="image-fallback">Image unavailable</div>
    : <img src={recipe.imageUrl} alt={recipe.title} loading="lazy" referrerPolicy="no-referrer"
        onError={() => setFailed(true)} />
}

function App() {
  const [user, setUser] = useState(null)
  const [recipes, setRecipes] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [feedError, setFeedError] = useState('')
  const [actionError, setActionError] = useState('')
  const [live, setLive] = useState(false)
  const [tab, setTab] = useState('all')
  const [author, setAuthor] = useState('')
  const [sortBy, setSortBy] = useState('date')
  const [order, setOrder] = useState('descending')
  const [modal, setModal] = useState(null)
  const [busy, setBusy] = useState(false)
  const revision = useRef(0)

  const refresh = useCallback(async () => {
    const request = ++revision.current
    try {
      const items = await api('/recipes')
      if (request !== revision.current) return
      setRecipes(items)
      setLoaded(true)
      setFeedError('')
    } catch (error) {
      if (request === revision.current) setFeedError(error.message)
    }
  }, [])

  useEffect(() => {
    let active = true
    api('/auth/me').then(current => { if (active) setUser(current) })
      .catch(error => { if (active) setActionError(error.message) })
    const events = new EventSource('/api/events')
    events.onopen = () => { setLive(true); refresh() }
    events.onerror = () => setLive(false)
    events.addEventListener('recipes', refresh)
    refresh()
    return () => {
      active = false
      events.close()
      revision.current++
    }
  }, [refresh])

  const close = () => {
    setModal(null)
    setActionError('')
  }
  function show(type, id) {
    setActionError('')
    setModal({ type, id })
  }
  async function authenticate(values) {
    const current = await api('/auth/' + modal.type, { method: 'POST', body: values })
    setUser(current)
    close()
    refresh()
  }
  async function save(values, id) {
    await api(id ? '/recipes/' + id : '/recipes', {
      method: id ? 'PUT' : 'POST', body: values
    })
    if (id) close()
    refresh()
  }
  async function act(path, method, after) {
    setActionError('')
    setBusy(true)
    try {
      await api(path, { method })
      after?.()
      await refresh()
    } catch (error) {
      setActionError(error.message)
    } finally {
      setBusy(false)
    }
  }

  const selected = recipes.find(recipe => recipe.id === modal?.id)
  const authorQuery = author.trim().toLowerCase()
  const visible = recipes.filter(recipe =>
    (tab === 'all' || recipe.author.id === user?.id) &&
    recipe.author.name.toLowerCase().includes(authorQuery)
  ).sort((first, second) => {
    const difference = sortBy === 'title'
      ? first.title.localeCompare(second.title)
      : Date.parse(first.createdAt) - Date.parse(second.createdAt)
    return order === 'ascending' ? difference : -difference
  })
  const auth = ['login', 'signup'].includes(modal?.type)
  return <>
    <main className="shell">
      <header>
        <h1>Welcome to Recipe Exchange</h1>
        <div className="nav-actions">
          {user ? <>
            <span className="user-name">Signed in as <strong>{user.name}</strong></span>
            <button disabled={busy} onClick={() => act('/auth/session', 'DELETE', () => {
              setUser(null)
              setTab('all')
            })}>Log out</button>
          </> : <>
            <button onClick={() => show('login')}>Log in</button>
            <button onClick={() => show('signup')}>Sign up</button>
          </>}
        </div>
      </header>
      <section className="create-section" aria-label="Create a recipe">
        {!user && <p className="hint">Log in or sign up to share a recipe.</p>}
        <RecipeForm save={save} disabled={!user} />
      </section>
      <section aria-labelledby="collection-heading">
        <div className="section-heading">
          <h2 id="collection-heading">{tab === 'mine' ? 'My recipes' : 'Community recipes'}</h2>
          <span className="hint" role="status">{live ? 'Live' : 'Connecting…'}</span>
        </div>
        <div className="filters">
          <label>Filter by author <input type="search" value={author} onChange={event => setAuthor(event.target.value)} /></label>
          <div className="nav-actions">
            <label>Sort by <select value={sortBy} onChange={event => setSortBy(event.target.value)}>
              <option value="date">Date added</option>
              <option value="title">Title</option>
            </select></label>
            <label>Sort order <select value={order} onChange={event => setOrder(event.target.value)}>
              <option value="descending">Descending</option>
              <option value="ascending">Ascending</option>
            </select></label>
          </div>
          {user && <nav className="nav-actions" aria-label="Recipe collections">
            <button aria-pressed={tab === 'all'} onClick={() => setTab('all')}>All recipes</button>
            <button aria-pressed={tab === 'mine'} onClick={() => setTab('mine')}>My recipes</button>
          </nav>}
        </div>
        {!modal && actionError && <p className="error" role="alert">{actionError}</p>}
        {feedError && <p className="error" role="alert">{feedError} <button className="text-button" onClick={refresh}>Retry</button></p>}
        {!loaded && !feedError && <p role="status">Loading recipes…</p>}
        {loaded && !visible.length && <p className="empty">
          {authorQuery ? 'No recipes match this author.' : tab === 'mine' ? 'You haven’t added a recipe yet.' : 'No recipes yet.'}
        </p>}
        <div className="recipe-list">
          {visible.map(recipe => {
            const ownRecipe = user?.id === recipe.author.id
            const likes = recipe.likeCount + (recipe.likeCount === 1 ? ' like' : ' likes')
            return <article className="recipe" key={recipe.id}>
              <div className="recipe-copy">
                <h3>{recipe.title}</h3>
                <div className="recipe-image"><RecipeImage recipe={recipe} key={recipe.imageUrl} /></div>
                <h4>Ingredients</h4>
                <ul className="ingredients">
                  {recipe.ingredients.map((ingredient, index) => <li key={index}>{ingredient}</li>)}
                </ul>
                <p className="byline">Shared by <strong>{recipe.author.name}</strong></p>
                <div className="nav-actions">
                  {ownRecipe ? <>
                    <span className="hint">{likes}</span>
                    <button className="text-button" onClick={() => show('edit', recipe.id)}>Edit</button>
                    <button className="text-button danger-text" onClick={() => show('delete', recipe.id)}>Delete</button>
                  </> : <button className="like-button" aria-pressed={recipe.liked} disabled={busy}
                    onClick={() => user ? act('/recipes/' + recipe.id + '/like', recipe.liked ? 'DELETE' : 'PUT') : show('login')}>
                    {recipe.liked ? 'Unlike' : 'Like'} · {recipe.likeCount}
                  </button>}
                </div>
              </div>
            </article>
          })}
        </div>
      </section>
    </main>
    {auth && <Modal title={modal.type === 'signup' ? 'Create an account' : 'Log in'} close={close}>
      <AuthForm key={modal.type} mode={modal.type} submit={authenticate}
        changeMode={() => show(modal.type === 'signup' ? 'login' : 'signup')} />
    </Modal>}
    {modal?.type === 'edit' && selected &&
      <Modal title="Edit recipe" close={close}>
        <RecipeForm key={selected.id} recipe={selected} save={values => save(values, selected.id)} />
      </Modal>}
    {modal?.type === 'delete' && selected && <Modal title="Delete recipe?" close={close}>
      <p>“{selected.title}” will be removed from the community feed.</p>
      {actionError && <p className="error" role="alert">{actionError}</p>}
      <div className="nav-actions">
        <button className="danger" disabled={busy} onClick={() => act('/recipes/' + selected.id, 'DELETE', close)}>Delete recipe</button>
        <button className="text-button" disabled={busy} onClick={close}>Cancel</button>
      </div>
    </Modal>}
    {modal?.id && !selected && <Modal title="Recipe unavailable" close={close}>
      <p>This recipe was removed from the feed.</p>
    </Modal>}
  </>
}

createRoot(document.getElementById('root')).render(<App />)
