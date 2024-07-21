import * as vscode from "vscode";
import { workspace } from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from "vscode-languageclient";

let client: LanguageClient;

export async function activate(context: vscode.ExtensionContext) {
  const serverModule = context.asAbsolutePath("server.js");
  const debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions
    }
  };

  const clientOptions: LanguageClientOptions = {
    // register server for sqlx files
    documentSelector: [{ scheme: "file", language: "sqlx" }],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher("**/.clientrc")
    }
  };

  client = new LanguageClient(
    "dataformLanguageServer",
    "Dataform Language Server",
    serverOptions,
    clientOptions
  );

  const compile = vscode.commands.registerCommand("dataform.compile", () => {
    const _ = client.sendRequest("compile");
  });

  const formatter = vscode.languages.registerDocumentFormattingEditProvider(
    "sqlx", { provideDocumentFormattingEdits },
  );

  context.subscriptions.push(compile, formatter);

  client.start();

  // wait for client to be ready before setting up notification handlers
  await client.onReady();
  client.onNotification("error", errorMessage => {
    vscode.window.showErrorMessage(errorMessage);
  });
  client.onNotification("info", message => {
    vscode.window.showInformationMessage(message);
  });
  client.onNotification("success", message => {
    vscode.window.showInformationMessage(message);
  });

  // Recommend YAML extension if not installed
  // We also can add the extension to "extensionDependencies" in package.json,
  // but this way we can avoid forcing users to install the extension.
  // You can control this recommendation behavior through the setting.
  if (workspace.getConfiguration("dataform").get("recommendYamlExtension")) {
    const yamlExtension = vscode.extensions.getExtension("redhat.vscode-yaml");
    if (!yamlExtension) {
      await vscode.window.showInformationMessage(
        "The Dataform extension recommends installing the YAML extension for workflow_settings.yaml support.",
        "Install",
        "Don't show again"
      ).then(selection => {
        if (selection === "Install") {
          // Open the YAML extension page
          vscode.env.openExternal(
            vscode.Uri.parse(
              "vscode:extension/redhat.vscode-yaml"
            )
          );
        } else if (selection === "Don't show again") {
          // Disable the recommendation
          workspace.getConfiguration("dataform").update(
            "recommendYamlExtension",
            false,
            vscode.ConfigurationTarget.Global
          );
        }
      });
    }
  }
}

async function provideDocumentFormattingEdits(_document: vscode.TextDocument, _options: vscode.FormattingOptions, token: vscode.CancellationToken): Promise<vscode.TextEdit[]> {
  const projectDir = await getProjectDirPath(token);
  if (projectDir instanceof Error) {
    await vscode.window.showErrorMessage(projectDir.message);
    return;
  }

  // Pass the path of the current file relative to the workspace root
  // (assuming that is same with the Dataform project directory) as an action.
  const action = vscode.workspace.asRelativePath(vscode.window.activeTextEditor.document.uri, false)
  await client.sendRequest("format", [projectDir, action], token);
}

// Gets the file system path to the current workspace root if it's a local
// Dataform project directory, or an error otherwise.
async function getProjectDirPath(token?: vscode.CancellationToken): Promise<string | Error> {
  // Check if the current document is in a workspace.
  const folder = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
  if (!folder) {
    return new Error("Dataform files outside of a workspace are not supported.");
  }

  // Check if the workspace is local.
  if (folder.uri.scheme !== "file") {
    return new Error("Remote Dataform files are not supported.");
  }

  // Check if the workspace root has a Dataform setting file.
  // dataform.json has been deprecated but is still supported.
  const yamlPattern = new vscode.RelativePattern(folder, "{workflow_settings.yaml,dataform.json}");
  const yamls = await vscode.workspace.findFiles(yamlPattern, null, 1, token)
  if (yamls.length === 0) {
    return new Error("Workspaces without workflow_settings.yaml (or dataform.json) are not supported.");
  }

  return folder.uri.fsPath;
}
