export function createProviders (options: any) {
  // TODO
  return new Providers(options)
}

export class Providers {
  providers: any[]

  constructor (options: any) {
    this.providers = []
    // TODO
    // this.providers.push(new OpenAIProvider(options))
  }

  select (config: any) {
    // TODO
    return this.providers[0]
  }
}
