import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { cn } from "@/lib/utils";

/** Tailwind-styled markdown renderer. No prose plugin — explicit element styles
 *  so we keep visual parity with the rest of the app. */
const components: Components = {
  h1: ({ children }) => <h1 className="mt-4 text-xl font-semibold tracking-tight first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-4 text-lg font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-3 text-base font-semibold first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-3 text-sm font-semibold first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="my-2 text-sm leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 ml-5 list-disc space-y-1 text-sm leading-relaxed marker:text-muted">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 ml-5 list-decimal space-y-1 text-sm leading-relaxed marker:text-muted">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-border pl-3 text-sm italic text-muted">{children}</blockquote>
  ),
  hr: () => <hr className="my-4 border-border" />,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="min-w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">{children}</thead>,
  th: ({ children }) => <th className="py-1.5 pr-4 font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b border-border/50 py-1.5 pr-4">{children}</td>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ className, children, ...props }) => {
    const isInline = !className;
    if (isInline) {
      return (
        <code className="rounded bg-subtle px-1 py-0.5 font-mono text-[0.85em]" {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className={cn("font-mono text-xs leading-relaxed", className)} {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-md bg-subtle p-3 font-mono text-xs leading-relaxed">
      {children}
    </pre>
  ),
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("text-fg [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, { ...defaultSchema, tagNames: [...(defaultSchema.tagNames ?? []), "sup", "sub"] }],
        ]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
