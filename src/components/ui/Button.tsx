import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "outline";
  wide?: boolean;
  icon?: ReactNode;
};

export function Button({ variant = "primary", wide, icon, children, className = "", ...props }: ButtonProps) {
  return (
    <button className={`button button--${variant} ${wide ? "button--wide" : ""} ${className}`} {...props}>
      {icon}
      <span>{children}</span>
    </button>
  );
}
