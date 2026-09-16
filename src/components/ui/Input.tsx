import { useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
};

export function Input({ label, ...props }: InputProps) {
  const labelId = useId();
  return (
    <label className="field">
      <span id={labelId}>{label}:</span>
      <input aria-labelledby={labelId} {...props} />
    </label>
  );
}

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
};

export function TextArea({ label, ...props }: TextAreaProps) {
  const labelId = useId();
  return (
    <label className="field">
      <span id={labelId}>{label}:</span>
      <textarea aria-labelledby={labelId} {...props} />
    </label>
  );
}
