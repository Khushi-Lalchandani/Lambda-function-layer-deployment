import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

type PromptVariables = Record<
  string,
  string | number | boolean | null | undefined
>;

@Injectable()
export class PromptTemplateService {
  private readonly cache = new Map<string, string>();
  private readonly promptDirectories = [
    path.resolve(process.cwd(), 'prompts'),
    path.resolve(process.cwd(), 'dist', 'prompts'),
    path.resolve(__dirname, '..', 'prompts'),
  ];

  public getTemplate(templateFileName: string): string {
    const cachedTemplate = this.cache.get(templateFileName);
    if (cachedTemplate != null) {
      return cachedTemplate;
    }

    const templatePath =
      this.promptDirectories
        .map((promptDirectory) => path.resolve(promptDirectory, templateFileName))
        .find((resolvedPath) => fs.existsSync(resolvedPath)) ?? '';

    if (!templatePath) {
      throw new Error(`Prompt template not found: ${templateFileName}`);
    }

    const templateContent = fs.readFileSync(templatePath, 'utf-8');
    this.cache.set(templateFileName, templateContent);
    return templateContent;
  }

  public renderTemplate(
    templateFileName: string,
    variables: PromptVariables,
  ): string {
    const template = this.getTemplate(templateFileName);

    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
      const value = variables[key];
      return String(value ?? '');
    });
  }
}
