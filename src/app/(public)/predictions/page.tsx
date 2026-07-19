import Link from "next/link";

const cats = [
  { slug: "featured", name: "Featured tips", desc: "Editor-picked, highest-conviction plays." },
  { slug: "genius", name: "Genius tips", desc: "AI-first picks scored by our model." },
  { slug: "today", name: "Today's predictions", desc: "Every match happening today." },
  { slug: "banker", name: "Banker", desc: "Our single most-confident pick." },
  { slug: "vip", name: "VIP", desc: "Subscriber-only edge plays." },
  { slug: "premium", name: "Premium", desc: "Top-tier tips + accumulators." },
];

export default function PredictionsIndex() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Predictions</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cats.map((c) => (
          <Link key={c.slug} href={`/predictions/${c.slug}`} className="card hover:border-brand">
            <div className="text-lg font-semibold">{c.name}</div>
            <p className="text-sm text-gray-400">{c.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
