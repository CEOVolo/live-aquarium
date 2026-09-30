using UnrealBuildTool;

public class LiveAquariumEditorTarget : TargetRules
{
	public LiveAquariumEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("LiveAquarium");
	}
}
