import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  p: ({ children }) => <p>{children}</p>,
  ul: ({ children }) => <ul>{children}</ul>,
  ol: ({ children }) => <ol>{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  blockquote: ({ children }) => <blockquote>{children}</blockquote>,
  hr: () => <hr />,
  table: ({ children }) => (
    <div className="popup-md-table-scroll scroll-area">
      <table>{children}</table>
    </div>
  ),
  code: ({ className, children, ...props }) => {
    const inline = !className;
    if (inline) {
      return (
        <code className="popup-md-inline-code" {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="scroll-area">{children}</pre>,
};

export function PopupMarkdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`popup-md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
