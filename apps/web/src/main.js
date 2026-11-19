import { mount } from 'svelte'
import 'maplibre-gl/dist/maplibre-gl.css'
import '@fontsource/pt-sans-narrow/latin-400.css'
import '@fontsource/pt-sans-narrow/latin-700.css'
import './app.css'
import App from './App.svelte'

mount(App, { target: document.getElementById('app') })
