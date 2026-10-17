/** Empty state for a discussion that has no messages yet. */
export function DiscussionEmpty({ message }: { message: string }) {
  return (
    <div className="flex min-h-full items-center justify-center px-6 py-10 text-center">
      <p className="text-[13px] leading-relaxed text-content/60">{message}</p>
    </div>
  );
}
