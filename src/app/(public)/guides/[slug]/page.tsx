import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GuideArticle } from "@/components/GuideArticle";
import { GUIDES, guideBySlug } from "@/content/guides";
import { JsonLd, articleJsonLd, breadcrumbJsonLd } from "@/lib/seo";

export function generateStaticParams() { return GUIDES.map((guide) => ({ slug: guide.slug })); }

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const guide = guideBySlug(params.slug);
  if (!guide) return { title: "Guide not found", robots: { index: false, follow: false } };
  return { title: guide.title, description: guide.description, alternates: { canonical: `/guides/${guide.slug}` } };
}

export default function GuidePage({ params }: { params: { slug: string } }) {
  const guide = guideBySlug(params.slug);
  if (!guide) notFound();
  const path = `/guides/${guide.slug}`;
  return <><JsonLd data={[breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Guides", path: "/guides" }, { name: guide.title, path }]), articleJsonLd({ headline: guide.title, description: guide.description, path, datePublished: guide.publishedAt, dateModified: guide.reviewedAt })]} /><GuideArticle guide={guide} /></>;
}

