type CirclePerson = "Sarah" | "Tom" | "Priya";

export default function CircleAvatar({ person }: { person: CirclePerson }) {
  return <span className={`circle-avatar circle-avatar-${person.toLowerCase()}`}>
    <img src={`/images/circle/${person.toLowerCase()}.png`} alt="" width={48} height={48} loading="lazy" decoding="async" />
  </span>;
}
