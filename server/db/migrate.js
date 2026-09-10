import 'dotenv/config'
import { migrate, pool } from './index.js'
await migrate()
console.log('✓ schema aplicado')
await pool.end()
