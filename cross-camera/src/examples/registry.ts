export interface DemoExample {
  slug: string
  title: string
  eyebrow: string
  description: string
  manifest: string
  available: boolean
}

export const examples: DemoExample[] = [
  {
    slug: 'cross-camera',
    title: 'Cross-camera vehicle association',
    eyebrow: 'O3 · Semantic-to-structure rewrite',
    description:
      'Associate the same physical vehicles across two synchronized highway cameras.',
    manifest: 'examples/cross-camera/manifest.json',
    available: true,
  },
  {
    slug: 'transcript-pushdown',
    title: 'Transcript-to-video localization',
    eyebrow: 'O2 · Coming next',
    description:
      'Use source-aligned text to restrict the video intervals sent to a semantic model.',
    manifest: '',
    available: false,
  },
]
