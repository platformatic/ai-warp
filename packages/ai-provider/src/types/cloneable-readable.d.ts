declare module 'cloneable-readable' {
  import { Readable } from 'node:stream'

  interface CloneableReadable extends Readable {
    clone(): CloneableReadable
  }

  function cloneable (stream: Readable): CloneableReadable

  export default cloneable
}
