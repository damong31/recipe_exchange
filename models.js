import mongoose from 'mongoose'

const { Schema, model } = mongoose

export function isImageUrl(value) {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}

export const User = model('User', new Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  username: { type: String, required: true, unique: true, sparse: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true }
}))

export const Session = model('Session', new Schema({
  tokenHash: { type: String, required: true, unique: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  expiresAt: { type: Date, required: true, expires: 0 }
}))

export const Recipe = model('Recipe', new Schema({
  title: { type: String, required: true, trim: true, maxlength: 100 },
  ingredients: {
    type: [{ type: String, required: true, trim: true, maxlength: 200 }],
    validate: items => items.length >= 1 && items.length <= 40
  },
  imageUrl: { type: String, required: true, maxlength: 2048, validate: isImageUrl },
  author: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  likes: [{ type: Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true }))

Recipe.schema.index({ createdAt: -1 })
