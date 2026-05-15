import { Router } from 'express'
import { ScheduledTaskRepository } from '../db/scheduled-task-repository.js'
import type { TaskScheduler } from '../scheduler/task-scheduler.js'

export function createScheduledTasksRouter(scheduler: TaskScheduler): Router {
  const router = Router({ mergeParams: true })

  // GET /api/bots/:botId/scheduled-tasks
  router.get('/', async (req, res) => {
    const { botId } = req.params as Record<string, string>
    const tasks = await ScheduledTaskRepository.findAll(botId)
    res.json(tasks)
  })

  // POST /api/bots/:botId/scheduled-tasks
  router.post('/', async (req, res) => {
    const { botId } = req.params as Record<string, string>
    const task = await ScheduledTaskRepository.create({ botId, ...req.body })
    if (task.enabled) {
      const nextRunAt = scheduler.computeNextRunAt(task.cronExpr)
      if (nextRunAt) await ScheduledTaskRepository.update(task.id, { nextRunAt })
      scheduler.registerTask({ ...task, nextRunAt: nextRunAt ?? null })
    }
    res.status(201).json(task)
  })

  // PUT /api/bots/:botId/scheduled-tasks/:id
  router.put('/:id', async (req, res) => {
    const task = await ScheduledTaskRepository.update(req.params.id, req.body)
    if (!task) { res.status(404).json({ error: 'Task not found' }); return }
    scheduler.unregisterTask(task.id)
    if (task.enabled) {
      const nextRunAt = scheduler.computeNextRunAt(task.cronExpr)
      if (nextRunAt) await ScheduledTaskRepository.update(task.id, { nextRunAt })
      scheduler.registerTask({ ...task, nextRunAt: nextRunAt ?? null })
    }
    res.json(task)
  })

  // DELETE /api/bots/:botId/scheduled-tasks/:id
  router.delete('/:id', async (req, res) => {
    scheduler.unregisterTask(req.params.id)
    await ScheduledTaskRepository.delete(req.params.id)
    res.status(204).send()
  })

  return router
}
