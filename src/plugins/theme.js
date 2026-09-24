import { Service } from 'cordis'

class Theme extends Service {
  constructor(ctx, id) { super(ctx, 'theme'); this.id = id }
}
export const themePlugin = id => ({ apply(ctx) { new Theme(ctx, id) } })
