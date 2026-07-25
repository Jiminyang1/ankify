export function getUserDisplayName(name: string, email: string) {
  const cleanName = name
    .trim()
    .split(/\s+/)
    .filter((part) => !/^(null|undefined)$/i.test(part))
    .join(" ");
  return cleanName || email.split("@")[0] || email;
}

export function getUserFirstName(name: string, email: string) {
  const displayName = getUserDisplayName(name, email);
  return displayName.split(/\s+/)[0] || displayName;
}
