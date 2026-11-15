import { cacheLife } from "next/cache";

async function BuiltAt() {
  "use cache";
  cacheLife("max");
  return <time>{new Date().toISOString()}</time>;
}

export default function StaticPage() {
  return (
    <main className="p-8 font-sans">
      <h1 className="text-xl font-semibold">Static page</h1>
      <p>
        Rendered at <BuiltAt />. This should not change between reloads in
        production.
      </p>
    </main>
  );
}
