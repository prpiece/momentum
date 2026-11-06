# Supabase (hosted) is the backend

We use hosted Supabase for auth, Postgres, row-level security, realtime and file storage. Row-level security in Postgres is what keeps shared lists and friend-visible stats safe without writing our own authorisation server, and the data is already relational. We rejected Firebase (NoSQL fits the relational schema poorly), PocketBase (we'd have to run our own server) and a custom server (the most work and the most security surface).
