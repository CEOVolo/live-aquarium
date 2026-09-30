using UnrealBuildTool;

public class LiveAquariumTarget : TargetRules
{
	public LiveAquariumTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("LiveAquarium");
	}
}
