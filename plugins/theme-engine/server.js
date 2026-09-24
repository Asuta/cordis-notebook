import { Service } from 'cordis'

class Theme extends Service {
  constructor(ctx, id) { super(ctx, 'theme'); this.id = id }
}
export const themeEngine = { apply(ctx) {
  Object.assign(new Service(ctx, 'themeEngine'), {
    activate(owner, id) { new Theme(owner, id) },
  })
} }
