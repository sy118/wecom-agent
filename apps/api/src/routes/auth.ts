import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../middleware/auth.js'

export const authRouter: Router = Router()

authRouter.post('/login', (req, res) => {
  const { password } = req.body as { password?: string }
  const adminPassword = process.env.ADMIN_PASSWORD
  if (!adminPassword) {
    res.status(500).json({ error: 'ADMIN_PASSWORD not configured' })
    return
  }
  if (password !== adminPassword) {
    res.status(401).json({ error: 'Invalid password' })
    return
  }
  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '24h' })
  res.json({ token })
})
