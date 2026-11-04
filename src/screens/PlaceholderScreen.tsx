type PlaceholderScreenProps = {
  title: string;
  body: string;
  note: string;
};

export function PlaceholderScreen({ title, body, note }: PlaceholderScreenProps) {
  return (
    <>
      <h1 className="screen-title">{title}</h1>
      <p className="placeholder-body">{body}</p>
      <p className="screen-note">{note}</p>
    </>
  );
}
