import { AiAuthoringService } from '../../src/desktop/ai-authoring';
import { readAiAttachments, resolveMentionedAiAttachmentPaths } from '../../src/desktop/ai-attachments';
import type { AiService } from '../../src/desktop/ai-service';
import type { AiRequest, AiResponse } from '../../src/core/ai';
import type { AiProgress } from '../../src/core/ai-workflow';
import type { Project } from '../../src/core/model';

/** Regression harness for the retained batch executors. The fixture supplies
 * explicit specialist parameters; production request routing is tested in ai-agent.test.ts. */
export class SpecialistHarness extends AiAuthoringService {
  private stopped = false;
  constructor(private provider: AiService, private fixtureOptions: { projectDirectory: (project: Project) => string | undefined; progress?: (value: AiProgress) => void }) { super(provider, fixtureOptions); }
  override cancel(id: string) { this.stopped = true; super.cancel(id); }
  override async request(input: AiRequest): Promise<AiResponse> {
    this.stopped = false;
    const request = { ...input };
    const check = () => { if (this.stopped) throw new Error('AI 任务已停止，工程没有修改。'); };
    const progress = (message: string, completed?: number, total?: number) => { check(); this.fixtureOptions.progress?.({ id: request.id, message, completed, total }); check(); };
    const paths = [...(input.attachmentPaths ?? []), ...(input.allowExternalFiles ? await resolveMentionedAiAttachmentPaths(input.prompt) : [])];
    request.attachments = await readAiAttachments(paths, check);
    const parameters: any = await this.provider.structured(input.id, '批量执行器测试参数（原规划器格式）：portraitBindings、editorCommands', { request: input.prompt, characters: input.project.characters, attachments: request.attachments });
    const plan = { editorCommands: [], execute: true, createStory: false, scenes: false, importFile: null, assetDirectory: null, voiceDirectory: null, portraits: false, portraitBindings: [], expressions: false, dialogueOnly: false, replaceVoices: false, message: '', ...parameters };
    return this['workflow'](request, plan, progress, check);
  }
}
