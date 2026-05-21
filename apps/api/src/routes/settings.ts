import { Router } from 'express'
import { SettingsRepository } from '../db/settings-repository.js'

export const settingsRouter: Router = Router()

settingsRouter.get('/', async (_req, res) => {
  res.json({ defaultSessionTtlMin: await SettingsRepository.getDefaultSessionTtlMin() })
})

settingsRouter.put('/', async (req, res) => {
  const defaultSessionTtlMin = await SettingsRepository.updateDefaultSessionTtlMin(req.body.defaultSessionTtlMin)
  if (defaultSessionTtlMin === null) {
    res.status(400).json({ error: 'defaultSessionTtlMin must be an integer between 1 and 1440' })
    return
  }
  res.json({ defaultSessionTtlMin })
})
