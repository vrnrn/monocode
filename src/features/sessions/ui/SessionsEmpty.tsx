/** Empty state for a session list or discussion with no content yet. */
export function SessionsEmpty({ message }: { message: string }) {
  return (
    <div className="flex min-h-full items-center justify-center px-6 py-10 text-center">
      <p className="text-[13px] leading-relaxed text-content/60">{message}</p>
    </div>
  );
}
