import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateThemeCss, type ThemeColors } from "../styles/themes.js";

export interface InitOptions {
  endpoint: string;
  ssg: "hugo" | "astro" | "eleventy" | "jekyll" | "nextjs";
  theme: string;
  customColors?: ThemeColors;
  dir: string;
}

const SSG_CONFIG: Record<string, {
  templatePath: string;
  template: (css: string) => string;
  workflowBuild: string;
  workflowPreBuild?: string;
}> = {
  hugo: {
    templatePath: "layouts/partials/ziscus.html",
    template: hugoPartial,
    workflowBuild: `      - uses: peaceiris/actions-hugo@v3
        with: { hugo-version: latest }
      - run: hugo --minify`,
    workflowPreBuild: "      - run: npx ziscus fetch --all",
  },
  astro: {
    templatePath: "src/components/Ziscus.astro",
    template: astroComponent,
    workflowBuild: `      - run: npm install
      - run: npx astro build`,
  },
  eleventy: {
    templatePath: "_includes/ziscus.njk",
    template: eleventyInclude,
    workflowBuild: "      - run: npx @11ty/eleventy",
  },
  jekyll: {
    templatePath: "_includes/ziscus.html",
    template: jekyllInclude,
    workflowBuild: `      - uses: ruby/setup-ruby@v1
        with: { ruby-version: '3.3' }
      - run: bundle install
      - run: bundle exec jekyll build`,
    workflowPreBuild: "      - run: npx ziscus fetch --all",
  },
  nextjs: {
    templatePath: "components/Ziscus.tsx",
    template: nextjsComponent,
    workflowBuild: `      - run: npm install
      - run: npx next build`,
  },
};

export async function runInit(options: InitOptions): Promise<void> {
  const { endpoint, ssg, theme, customColors, dir } = options;
  const config = SSG_CONFIG[ssg];
  if (!config) throw new Error(`Unknown SSG: ${ssg}`);

  const css = customColors
    ? generateThemeCss(customColors)
    : generateThemeCss(theme);

  // 1. Write config
  await writeFile(
    join(dir, "ziscus.config.json"),
    JSON.stringify({ endpoint, ssg, theme }, null, 2) + "\n",
  );

  // 2. Write template
  const templateDir = join(dir, ...config.templatePath.split("/").slice(0, -1));
  await mkdir(templateDir, { recursive: true });
  await writeFile(join(dir, config.templatePath), config.template(css));

  // 3. Write workflow
  const workflowDir = join(dir, ".github", "workflows");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(join(workflowDir, "rebuild-comments.yml"), generateWorkflow(config));
}

function generateWorkflow(config: { workflowBuild: string; workflowPreBuild?: string }): string {
  const preBuild = config.workflowPreBuild ? `\n${config.workflowPreBuild}` : "";
  return `name: Rebuild comments
on:
  repository_dispatch:
    types: [rebuild-comments]
permissions:
  contents: write
jobs:
  rebuild:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }${preBuild}
${config.workflowBuild}
      - name: Commit and push
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add -A
          git diff --cached --quiet && echo "No changes" && exit 0
          git commit -m "rebuild: bake fresh comments"
          git push
`;
}

function hugoPartial(css: string): string {
  return `{{- $endpoint := .Site.Params.ziscus.endpoint -}}
{{- $slug := "" -}}
{{- with .File -}}
  {{- $slug = .ContentBaseName | urlize -}}
{{- else -}}
  {{- $slug = .Page.Title | urlize -}}
{{- end -}}
{{- $comments := index .Site.Data "comments" $slug | default (slice) -}}

<div class="ziscus">
  <style>${css}</style>

  {{ if $comments }}
  <h2>{{ len $comments }} Comment{{ if ne (len $comments) 1 }}s{{ end }}</h2>
  {{ range $comments }}
  <article class="ziscus-comment">
    <header class="ziscus-header">
      <strong class="ziscus-author">{{ .author }}</strong>
      <time class="ziscus-time" datetime="{{ .created_at }}">{{ dateFormat "January 2, 2006" .created_at }}</time>
    </header>
    <p class="ziscus-body">{{ .body }}</p>
  </article>
  {{ end }}
  {{ else }}
  <h2>Comments</h2>
  <p>No comments yet.</p>
  {{ end }}

  <form method="POST" action="{{ $endpoint }}/submit" class="ziscus-form">
    <input type="hidden" name="slug" value="{{ $slug }}">
    <div><label for="ziscus-author">Name</label>
    <input type="text" name="author" id="ziscus-author" required></div>
    <div><label for="ziscus-body">Comment</label>
    <textarea name="body" id="ziscus-body" rows="4" required></textarea></div>
    <button type="submit">Post Comment</button>
  </form>
</div>
`;
}

function astroComponent(css: string): string {
  return `---
import { fetchComments } from "ziscus";

interface Props {
  slug: string;
  endpoint: string;
}

const { slug, endpoint } = Astro.props;
const comments = await fetchComments(slug, endpoint);
const approved = comments.filter(c => c.status === "approved");
---

<div class="ziscus">
  <style is:inline>
${css}
  </style>

  {approved.length > 0 ? (
    <>
      <h2>{approved.length} {approved.length === 1 ? "Comment" : "Comments"}</h2>
      {approved.map(c => (
        <article class="ziscus-comment">
          <header class="ziscus-header">
            <strong class="ziscus-author">{c.author}</strong>
            <time class="ziscus-time" datetime={c.createdAt}>
              {new Date(c.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}
            </time>
          </header>
          <p class="ziscus-body">{c.body}</p>
        </article>
      ))}
    </>
  ) : (
    <>
      <h2>Comments</h2>
      <p>No comments yet.</p>
    </>
  )}

  <form method="POST" action={\`\${endpoint}/submit\`} class="ziscus-form">
    <input type="hidden" name="slug" value={slug} />
    <div><label for="ziscus-author">Name</label>
    <input type="text" name="author" id="ziscus-author" required /></div>
    <div><label for="ziscus-body">Comment</label>
    <textarea name="body" id="ziscus-body" rows="4" required /></div>
    <button type="submit">Post Comment</button>
  </form>
</div>
`;
}

function eleventyInclude(css: string): string {
  return `<div class="ziscus">
  <style>${css}</style>
  {% set slugComments = comments[slug] %}
  {% if slugComments and slugComments.length %}
  <h2>{{ slugComments.length }} Comment{{ "s" if slugComments.length != 1 }}</h2>
  {% for c in slugComments %}
  <article class="ziscus-comment">
    <header class="ziscus-header">
      <strong class="ziscus-author">{{ c.author }}</strong>
      <time class="ziscus-time" datetime="{{ c.created_at }}">{{ c.created_at }}</time>
    </header>
    <p class="ziscus-body">{{ c.body }}</p>
  </article>
  {% endfor %}
  {% else %}
  <h2>Comments</h2>
  <p>No comments yet.</p>
  {% endif %}

  <form method="POST" action="{{ endpoint }}/submit" class="ziscus-form">
    <input type="hidden" name="slug" value="{{ slug }}">
    <div><label for="ziscus-author">Name</label>
    <input type="text" name="author" id="ziscus-author" required></div>
    <div><label for="ziscus-body">Comment</label>
    <textarea name="body" id="ziscus-body" rows="4" required></textarea></div>
    <button type="submit">Post Comment</button>
  </form>
</div>
`;
}

function jekyllInclude(css: string): string {
  return `<div class="ziscus">
  <style>${css}</style>
  {% assign slug_comments = site.data.comments[page.slug] %}
  {% if slug_comments.size > 0 %}
  <h2>{{ slug_comments.size }} Comment{% if slug_comments.size != 1 %}s{% endif %}</h2>
  {% for c in slug_comments %}
  <article class="ziscus-comment">
    <header class="ziscus-header">
      <strong class="ziscus-author">{{ c.author }}</strong>
      <time class="ziscus-time" datetime="{{ c.created_at }}">{{ c.created_at | date: "%B %-d, %Y" }}</time>
    </header>
    <p class="ziscus-body">{{ c.body }}</p>
  </article>
  {% endfor %}
  {% else %}
  <h2>Comments</h2>
  <p>No comments yet.</p>
  {% endif %}

  <form method="POST" action="{{ site.ziscus.endpoint }}/submit" class="ziscus-form">
    <input type="hidden" name="slug" value="{{ page.slug }}">
    <div><label for="ziscus-author">Name</label>
    <input type="text" name="author" id="ziscus-author" required></div>
    <div><label for="ziscus-body">Comment</label>
    <textarea name="body" id="ziscus-body" rows="4" required></textarea></div>
    <button type="submit">Post Comment</button>
  </form>
</div>
`;
}

function nextjsComponent(css: string): string {
  return `import { fetchComments } from "ziscus";

interface Props {
  slug: string;
  endpoint: string;
}

export async function Ziscus({ slug, endpoint }: Props) {
  const comments = await fetchComments(slug, endpoint);
  const approved = comments.filter(c => c.status === "approved");

  return (
    <div className="ziscus">
      <style dangerouslySetInnerHTML={{ __html: \`${css.replace(/`/g, "\\`")}\` }} />

      {approved.length > 0 ? (
        <>
          <h2>{approved.length} {approved.length === 1 ? "Comment" : "Comments"}</h2>
          {approved.map(c => (
            <article key={c.id} className="ziscus-comment">
              <header className="ziscus-header">
                <strong className="ziscus-author">{c.author}</strong>
                <time className="ziscus-time" dateTime={c.createdAt}>
                  {new Date(c.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}
                </time>
              </header>
              <p className="ziscus-body">{c.body}</p>
            </article>
          ))}
        </>
      ) : (
        <>
          <h2>Comments</h2>
          <p>No comments yet.</p>
        </>
      )}

      <form method="POST" action={\`\${endpoint}/submit\`} className="ziscus-form">
        <input type="hidden" name="slug" value={slug} />
        <div><label htmlFor="ziscus-author">Name</label>
        <input type="text" name="author" id="ziscus-author" required /></div>
        <div><label htmlFor="ziscus-body">Comment</label>
        <textarea name="body" id="ziscus-body" rows={4} required /></div>
        <button type="submit">Post Comment</button>
      </form>
    </div>
  );
}
`;
}
