export interface Document {
  title: string;
  url: string;
  source: string;
  layout: string;
  date?: string;
  year?: string;
  categories: string[];
  tags: string[];
}

export interface Manifest {
  site: {
    title: string;
    description: string;
    author: { name: string; bio: string; location: string; links: { label: string; url: string }[] };
  };
  navigation: { title: string; url: string }[];
  posts: Document[];
  pages: Document[];
  templates: Record<string, string>;
}
