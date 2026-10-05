/**
 * A document in which every parse window passes the complexity check but one chunk, which straddles two
 * windows and holds the delimiters of both, does not: segmentation succeeds and that chunk is a failed section.
 */
export function straddlingComplexChunkDocument(prefix = "", suffix = "", prose = "Ordinary paragraph of plain prose.\n\n"): string {
  let text = prefix + prose.repeat(Math.round((20_000 - prefix.length) / prose.length));
  text += `${"*a* ".repeat(1_900).trim()}\n\n`;
  text += "plain line of words here\n".repeat(Math.round((30_500 - text.length) / 25));
  text += `${"*a* ".repeat(1_900).trim()}\n\n`;
  return text + prose.repeat(Math.ceil((101_000 - text.length) / prose.length)) + suffix;
}
