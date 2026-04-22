import { testSupabaseConnection } from '../api/supabase/_test'

console.log("🔥 HOME FILE LOADED")

export default function Home() {
  return (
    <div>
      <h1>HOME LOADED</h1>

      <button onClick={testSupabaseConnection}>
        Test
      </button>
    </div>
  )
}