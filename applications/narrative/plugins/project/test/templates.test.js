import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFlowHandlers } from '../../flow/model.js'
import { createDialoguePlayer } from '../../dialogue/player.js'
import { registerRules } from '../../rules/engine.js'
import { createChatController } from '../../ai-dialogue/chat.js'
import { validateRuntime } from '../model.js'
import { owner, setup } from './helpers.js'

// Use the production interpreters so template reachability includes condition
// gates, actions, rules and chat continuations rather than just graph edges.
for (const template of ['hybrid', 'galgame', 'tavern']) {
  const routes = template === 'tavern'
    ? [{ choices: [], ending: 'quiet' }]
    : [{ choices: ['stay', 'give', 'together'], ending: 'starlight' }, { choices: ['leave', 'home'], ending: 'quiet' }]
  for (const route of routes) test(`${template} 模板通过真实剧情、规则和离线聊天走到 ${route.ending}，完成状态可以存档`, async t => {
    const { engine, toasts } = await setup(t, { template }), plugin = owner()
    t.after(() => plugin.dispose())
    for (const handler of Object.values(createFlowHandlers(engine))) engine.registerNode(plugin, handler)
    registerRules(plugin, engine)
    const chat = createChatController(plugin, engine, () => assert.fail('默认模板不应调用外部 AI'), () => ({}))
    const player = createDialoguePlayer(engine)
    t.after(() => player.dispose())
    async function readScene() {
      if (engine.scene().type === 'chat') {
        assert.equal(await chat.send('想听听这张旧唱片的故事。'), true)
        assert.ok(engine.runtime.transcript.some(message => message.role === 'user'))
        await chat.continueStory(engine.scene())
      }
      for (let count = 0; !player.view().atEnd && count < 20; count++) await player.advance()
      assert.equal(player.view().atEnd, true)
    }
    await engine.play()
    for (const choice of route.choices) {
      await readScene()
      assert.equal(player.view().choices.find(item => item.id === choice)?.available, true, `${choice} 的条件必须能够满足`)
      assert.equal(await player.choose(choice), true)
    }
    await readScene()
    assert.equal(engine.runtime.nodeId, route.ending)
    assert.equal(engine.runtime.ended, true)
    assert.equal(engine.runtime.error, '')
    assert.equal(engine.runtime.busy, false)
    validateRuntime(engine.runtime, engine.project)
    if (route.ending === 'starlight') {
      assert.equal(engine.runtime.variables.trust, 3)
      assert.ok(engine.runtime.firedRules.includes('first-gift'))
    }
    assert.deepEqual(toasts, [])
  })
}
