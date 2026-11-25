export const parseComplaintResultRows = (result: string) => result.split(/\r?\n/).map((line) => {
  const row = line.split('\t')
  if (row.length !== 29)
    return row

  // Convert the two candidate-leading priorities to the shared priority used by the UI.
  return [...row.slice(1, 14), ...row.slice(15), row[0]]
})
