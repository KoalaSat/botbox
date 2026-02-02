import './relays.css'
import Relays from './Relays.svelte'
import { mount } from 'svelte'

const app = mount(Relays, {
  target: document.getElementById('app')!,
})

export default app
