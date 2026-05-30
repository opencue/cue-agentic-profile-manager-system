/**
 * Recommended 8-bucket consolidation, seeded into the Merge Studio so it opens
 * pre-populated. The user tweaks membership, then saves each as a static
 * profile or a live alias. This is a STARTING POINT, not a hard mapping —
 * overlaps (coolify/hostinger in both commerce and ops) are fine; the merge
 * engine dedupes on save.
 *
 * `members` are profile names that must exist under `profiles/`. The studio
 * cross-checks them against `/api/v1/profiles/full` and quietly drops any that
 * no longer exist, so renaming a source profile never breaks the seed.
 */

export interface SeedBucket {
  name: string;
  icon: string;
  blurb: string;
  members: string[];
}

export const SEED_BUCKETS: SeedBucket[] = [
  {
    name: "commerce",
    icon: "🛒",
    blurb: "Ecommerce end-to-end — Medusa backend, storefront, payments, email, deploy",
    members: ["webshop", "medusa-dev", "medusa-vite", "stripe", "resend", "coolify", "hostinger", "postgres"],
  },
  {
    name: "growth",
    icon: "📈",
    blurb: "Marketing, content, SEO, paid, social",
    members: ["marketing", "affiliate", "blog-writer", "creativity", "google-ads", "google-analytics", "postizz", "instagram", "trendradar"],
  },
  {
    name: "studio",
    icon: "🎨",
    blurb: "Visual + creative generation — design, image, video, brand",
    members: ["designer", "creative-media", "higgsfield", "supercomputer", "video", "event-design", "threejs", "readme-writer"],
  },
  {
    name: "builder",
    icon: "🔧",
    blurb: "General software dev — APIs, frontends, languages, frameworks",
    members: ["backend", "frontend", "nextjs", "vite", "python", "go-api", "react-native", "wordpress", "claude-api", "rust"],
  },
  {
    name: "maker",
    icon: "🧬",
    blurb: "Meta — skill engineering + multi-agent orchestration",
    members: ["skill-writer", "gstack", "fleet-control"],
  },
  {
    name: "secops",
    icon: "🛡️",
    blurb: "Security audit + pentest",
    members: ["cybersecurity"],
  },
  {
    name: "research",
    icon: "🔬",
    blurb: "Research, analysis, simulation, optimization, docs",
    members: ["research", "predict-everything", "nvidia", "docs-writer"],
  },
  {
    name: "ops",
    icon: "☁️",
    blurb: "Infra + SaaS ops",
    members: ["aws", "vercel", "coolify", "hostinger", "google-drive", "slack", "linear"],
  },
];
