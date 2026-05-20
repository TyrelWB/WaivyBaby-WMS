import postgres from 'postgres'

const sql = postgres(process.env.SUPABASE_DB_URL!, {
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
})

export default sql
