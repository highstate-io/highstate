import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import Handlebars from "handlebars"

/**
 * Copies all files from a template path to a destination path, replacing
 * variables in the format {{variableName}} with their corresponding values
 * and removing `.tpl` segments from file names.
 *
 * For example, `package.tpl.json` becomes `package.json` and `config.tpl` becomes `config`.
 *
 * @param templatePath The absolute path to the template directory.
 * @param destinationPath The absolute path to the destination directory.
 * @param variables The record of variable names and their replacement values.
 */
export async function generateFromTemplate(
  templatePath: string,
  destinationPath: string,
  variables: Record<string, string>,
): Promise<void> {
  const resolvedTemplatePath = resolve(templatePath)
  const resolvedDestinationPath = resolve(destinationPath)

  const templateStats = await stat(resolvedTemplatePath)
  if (!templateStats.isDirectory()) {
    throw new Error(`templatePath must be a directory: ${resolvedTemplatePath}`)
  }

  await mkdir(resolvedDestinationPath, { recursive: true })

  const renderTemplate = (raw: string): string => {
    const template = Handlebars.compile(raw, {
      strict: true,
      noEscape: true,
    })

    return template(variables)
  }

  const visit = async (absoluteSourcePath: string): Promise<void> => {
    const sourceStats = await stat(absoluteSourcePath)
    if (sourceStats.isDirectory()) {
      const relativePath = relative(resolvedTemplatePath, absoluteSourcePath)
      const destinationDirPath = join(resolvedDestinationPath, relativePath)

      await mkdir(destinationDirPath, { recursive: true })

      const entries = await readdir(absoluteSourcePath, { withFileTypes: true })
      for (const entry of entries) {
        await visit(join(absoluteSourcePath, entry.name))
      }

      return
    }

    if (!sourceStats.isFile()) {
      return
    }

    const relativeFilePath = relative(resolvedTemplatePath, absoluteSourcePath)
    const destinationRelativePath = relativeFilePath.replaceAll(".tpl", "")
    const destinationFilePath = join(resolvedDestinationPath, destinationRelativePath)

    await mkdir(dirname(destinationFilePath), { recursive: true })

    const contents = await readFile(absoluteSourcePath, "utf8")
    const rendered = renderTemplate(contents)
    if (rendered.trim().length === 0) {
      return
    }

    await writeFile(destinationFilePath, rendered, "utf8")
  }

  await visit(resolvedTemplatePath)
}
