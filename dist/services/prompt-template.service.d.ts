type PromptVariables = Record<string, string | number | boolean | null | undefined>;
export declare class PromptTemplateService {
    private readonly cache;
    private readonly promptDirectories;
    getTemplate(templateFileName: string): string;
    renderTemplate(templateFileName: string, variables: PromptVariables): string;
}
export {};
//# sourceMappingURL=prompt-template.service.d.ts.map