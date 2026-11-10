export function parseImportOptions(arguments_: readonly string[]) {
  const result = { validateOnly: false, allowIdenticalDuplicates: false };
  for (const argument of arguments_) {
    if (argument === "--validate-only") result.validateOnly = true;
    else if (argument === "--allow-identical-duplicates")
      result.allowIdenticalDuplicates = true;
    else throw new Error(`Unknown import option: ${argument}`);
  }
  return result;
}
