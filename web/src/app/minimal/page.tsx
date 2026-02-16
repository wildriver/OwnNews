export const runtime = 'edge'

export default function MinimalPage() {
    return (
        <div style={{ padding: '50px', fontFamily: 'sans-serif', textAlign: 'center' }}>
            <h1>Hello from Cloudflare Pages</h1>
            <p>This is a minimal page with NO external dependencies.</p>
            <p>Build Time: {new Date().toISOString()}</p>
        </div>
    )
}
