"use client";

import { createContext, useContext, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { safeUrl } from "@/lib/markdown-url";

const VN_IMAGE = "vn-image://";

/** The 0-based source line of the task item being rendered, so its checkbox knows what to tick. */
const TaskLine = createContext<number | null>(null);

type Props = {
  body: string;
  /** A task box was clicked: its 0-based line in `body` and the new state. Without it, boxes are read-only. */
  onTick?(line: number, checked: boolean): void;
  /** Renders a page image (`vn-image://<name>`); without it, page images are left out. */
  imageFor?(name: string, alt: string): ReactNode;
};

/** A page body rendered read-only: GitHub-flavoured markdown, no raw HTML, safe links only. */
export function Markdown({ body, onTick, imageFor }: Props) {
  const components: Components = {
    li({ node, children, className, ...rest }) {
      const line = className?.includes("task-list-item") && node?.position ? node.position.start.line - 1 : null;
      return (
        <li className={className} {...rest}>
          <TaskLine.Provider value={line}>{children}</TaskLine.Provider>
        </li>
      );
    },
    input(props) {
      // eslint-disable-next-line react-hooks/rules-of-hooks -- components render as React components
      const line = useContext(TaskLine);
      if (props.type !== "checkbox") return null;
      return (
        <input
          type="checkbox"
          checked={!!props.checked}
          disabled={!onTick || line === null}
          onChange={(e) => line !== null && onTick?.(line, e.target.checked)}
          className="mr-2 size-4 translate-y-0.5 accent-foreground"
        />
      );
    },
    img({ src, alt }) {
      if (typeof src === "string" && src.startsWith(VN_IMAGE) && imageFor) return <>{imageFor(src.slice(VN_IMAGE.length), alt ?? "")}</>;
      if (typeof src === "string" && /^https?:/i.test(src)) {
        // eslint-disable-next-line @next/next/no-img-element -- remote images in a static export
        return <img src={src} alt={alt ?? ""} loading="lazy" referrerPolicy="no-referrer" />;
      }
      return null;
    },
    a({ href, children }) {
      if (!href) return <span>{children}</span>;
      const external = /^(https?:|mailto:)/i.test(href);
      return (
        <a href={href} {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}>
          {children}
        </a>
      );
    },
  };

  return (
    <div className="vn-prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeUrl} components={components}>
        {body}
      </ReactMarkdown>
    </div>
  );
}
