import Image from "next/image";

export default function ImagePage() {
  return (
    <main className="p-8 font-sans">
      <h1 className="text-xl font-semibold">next/image</h1>
      <Image src="/test.png" alt="Test image" width={128} height={128} />
    </main>
  );
}
