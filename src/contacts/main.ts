import './contacts.css'
import Contacts from './Contacts.svelte'
import { mount } from 'svelte'

const app = mount(Contacts, {
  target: document.getElementById('app')!,
})

export default app
