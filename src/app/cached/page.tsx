import { cacheLife, cacheTag } from "next/cache";

async function CachedTime() {
  "use cache";
  cacheTag("time");
  cacheLife("hours");
  return <time data-testid="cached-time">{new Date().toISOString()}</time>;
}

export default function CachedPage() {
  return (
    <main className="p-8 font-sans">
      <h1 className="text-xl font-semibold">Cached page</h1>
      <p>
        Cached at <CachedTime />. <code>POST /api/revalidate</code> expires the
        <code> time</code> tag.
      </p>
    </main>
  );
}
