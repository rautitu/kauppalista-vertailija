const features = [
  'Bun workspace -monorepo',
  'Next.js web-sovellus',
  'Bun + Hono API /health-päätepisteellä',
  'PostgreSQL Docker Composella',
  'Worker-sovelluksen pohja myöhempiä jobeja varten',
];

export default function HomePage() {
  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '4rem 1.5rem' }}>
      <section style={{ background: '#fff', borderRadius: 16, padding: '2rem', boxShadow: '0 10px 30px rgba(0,0,0,0.06)' }}>
        <p style={{ textTransform: 'uppercase', letterSpacing: '0.08em', color: '#2563eb', fontWeight: 700 }}>Milestone 1</p>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>Kauppalista-vertailijan projektin perustus</h1>
        <p style={{ fontSize: '1.125rem', lineHeight: 1.6 }}>
          Monorepon ensimmäinen vaihe on käynnissä: web, API, worker ja PostgreSQL on scaffoldattu Docker-ympäristöön.
        </p>
        <ul style={{ marginTop: '1.5rem', paddingLeft: '1.25rem', lineHeight: 1.8 }}>
          {features.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
