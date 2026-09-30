#include "AquariumGameMode.h"

#include "AquariumAmbience.h"
#include "AquariumFishPawn.h"
#include "AquariumHUD.h"
#include "AquariumShark.h"
#include "Engine/World.h"

AAquariumGameMode::AAquariumGameMode()
{
	DefaultPawnClass = AAquariumFishPawn::StaticClass();
	HUDClass = AAquariumHUD::StaticClass();
	PrimaryActorTick.bCanEverTick = true;
}

void AAquariumGameMode::StartPlay()
{
	Super::StartPlay();
	// «мозги» сцены: акула-охотник и живые стайки (сами актёры уже стоят в уровне)
	GetWorld()->SpawnActor<AAquariumShark>();
	GetWorld()->SpawnActor<AAquariumAmbience>();
}

void AAquariumGameMode::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	SurviveTime += DeltaSeconds;
	BestTime = FMath::Max(BestTime, SurviveTime);
	CaughtMessageTime = FMath::Max(0.f, CaughtMessageTime - DeltaSeconds);
}

void AAquariumGameMode::OnPlayerCaught(AAquariumFishPawn* Fish)
{
	++TimesCaught;
	SurviveTime = 0.f;
	CaughtMessageTime = 3.f;
	if (Fish)
	{
		Fish->Respawn();
	}
}
