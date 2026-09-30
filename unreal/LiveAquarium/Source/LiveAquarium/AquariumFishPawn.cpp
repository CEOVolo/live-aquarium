#include "AquariumFishPawn.h"

#include "AquariumTypes.h"
#include "Camera/CameraComponent.h"
#include "Components/SphereComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/CollisionProfile.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/SpringArmComponent.h"
#include "Kismet/KismetSystemLibrary.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Misc/CommandLine.h"
#include "UnrealClient.h"

DEFINE_LOG_CATEGORY_STATIC(LogAquariumFish, Log, All);

namespace
{
	// Ось носа модели игрока (французский ангел, FISH_SPECIES в unreal/scripts/lt_common.py).
	const FVector PlayerNoseLocal(1.f, 0.f, 0.f);
	// Автопилот: круг у рифа, моменты снимков экрана (с).
	const FVector AutopilotCenter(700.f, 0.f, 230.f);
	constexpr float AutopilotRadius = 800.f;
	constexpr float AutopilotShotTimes[] = {8.f, 16.f, 24.f, 32.f};
}

AAquariumFishPawn::AAquariumFishPawn()
{
	PrimaryActorTick.bCanEverTick = true;
	bUseControllerRotationPitch = false;
	bUseControllerRotationYaw = false;
	bUseControllerRotationRoll = false;

	Collision = CreateDefaultSubobject<USphereComponent>(TEXT("Collision"));
	Collision->InitSphereRadius(18.f);
	Collision->SetCollisionProfileName(UCollisionProfile::Pawn_ProfileName);
	RootComponent = Collision;

	Arm = CreateDefaultSubobject<USpringArmComponent>(TEXT("Arm"));
	Arm->SetupAttachment(Collision);
	// три четверти сзади-справа и чуть сверху: ангел плоский с боков — строго сзади он виден полоской
	Arm->TargetArmLength = 230.f;
	Arm->SocketOffset = FVector(0.f, 70.f, 45.f);
	Arm->bUsePawnControlRotation = true;
	Arm->bEnableCameraLag = true;
	Arm->CameraLagSpeed = 8.f;
	Arm->bEnableCameraRotationLag = true;
	Arm->CameraRotationLagSpeed = 10.f;
	Arm->ProbeSize = 12.f;

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(Arm, USpringArmComponent::SocketName);
	Camera->SetFieldOfView(75.f);
}

void AAquariumFishPawn::BeginPlay()
{
	Super::BeginPlay();
	bAutopilot = FParse::Param(FCommandLine::Get(), TEXT("autopilot"));
	FParse::Value(FCommandLine::Get(), TEXT("autopilotseconds="), AutopilotSeconds);
	for (TActorIterator<AActor> It(GetWorld()); It; ++It)
	{
		if (It->ActorHasTag(AquariumTags::StreamCam))
		{
			StreamCamera = *It;
			break;
		}
	}
	AdoptFishBody();
	SpawnTransform = GetActorTransform();
}

void AAquariumFishPawn::PossessedBy(AController* NewController)
{
	Super::PossessedBy(NewController);
	if (APlayerController* PC = Cast<APlayerController>(NewController))
	{
		PC->SetInputMode(FInputModeGameOnly());
		PC->bShowMouseCursor = false;
		PC->SetControlRotation(GetActorRotation());
		if (FParse::Param(FCommandLine::Get(), TEXT("streamview")))
		{
			SetStreamView(true);
		}
	}
}

void AAquariumFishPawn::SetStreamView(bool bEnable)
{
	APlayerController* PC = Cast<APlayerController>(GetController());
	if (!PC)
	{
		return;
	}
	bStreamView = bEnable && StreamCamera.IsValid();
	PC->SetViewTargetWithBlend(bStreamView ? StreamCamera.Get() : static_cast<AActor*>(this), 0.6f);
}

void AAquariumFishPawn::AdoptFishBody()
{
	AActor* Root = nullptr;
	for (TActorIterator<AActor> It(GetWorld()); It; ++It)
	{
		if (It->ActorHasTag(AquariumTags::PlayerFish))
		{
			Root = *It;
			break;
		}
	}
	if (!Root)
	{
		UE_LOG(LogAquariumFish, Warning, TEXT("No actor tagged PlayerFish: the player fish has no body"));
		return;
	}

	TArray<AActor*> Parts;
	Root->GetAttachedActors(Parts, true, true);
	Parts.Add(Root);
	for (AActor* Part : Parts)
	{
		TArray<UPrimitiveComponent*> Prims;
		Part->GetComponents(Prims);
		for (UPrimitiveComponent* Prim : Prims)
		{
			Prim->SetMobility(EComponentMobility::Movable);
			Prim->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		}
	}

	// Пешку — в центр рыбы, её +X — вдоль носа; прикрепить рыбу и вернуть пешку в точку старта.
	FVector Center, Extent;
	Root->GetActorBounds(false, Center, Extent, true);
	const FVector NoseWorld = Root->GetActorTransform().TransformVectorNoScale(PlayerNoseLocal);
	const FTransform Start = GetActorTransform();
	SetActorLocationAndRotation(Center, FRotationMatrix::MakeFromXZ(NoseWorld, FVector::UpVector).Rotator(),
		false, nullptr, ETeleportType::TeleportPhysics);
	Root->AttachToActor(this, FAttachmentTransformRules::KeepWorldTransform);
	SetActorTransform(Start, false, nullptr, ETeleportType::TeleportPhysics);

	for (AActor* Part : Parts)
	{
		TArray<UStaticMeshComponent*> Meshes;
		Part->GetComponents(Meshes);
		for (UStaticMeshComponent* Mesh : Meshes)
		{
			for (int32 i = 0; i < Mesh->GetNumMaterials(); ++i)
			{
				if (UMaterialInstanceDynamic* MID = Mesh->CreateAndSetMaterialInstanceDynamic(i))
				{
					SwimMaterials.Add(MID);
					BaseAmp.Add(MID->K2_GetScalarParameterValue(TEXT("Amp")));
				}
			}
		}
	}
	UE_LOG(LogAquariumFish, Log, TEXT("Player fish: %d actors, %d swim materials"), Parts.Num(), SwimMaterials.Num());
}

void AAquariumFishPawn::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	const float Dt = FMath::Min(DeltaSeconds, 0.1f);
	FrozenTime = FMath::Max(0.f, FrozenTime - Dt);

	FVector Wish = FVector::ZeroVector;
	bool bBoost = false;
	if (bAutopilot)
	{
		RunAutopilot(Dt, Wish, bBoost);
	}
	else
	{
		ReadPlayerInput(Dt, Wish, bBoost);
	}
	if (FrozenTime > 0.f)
	{
		Wish = FVector::ZeroVector;
		bBoost = false;
	}

	const bool bBoosting = bBoost && BoostEnergy > 0.02f && !Wish.IsNearlyZero();
	BoostEnergy = FMath::Clamp(BoostEnergy + (bBoosting ? -0.35f : 0.2f) * Dt, 0.f, 1.f);
	const float MaxSpeed = bBoosting ? BoostSpeed : CruiseSpeed;

	Velocity += Wish * Acceleration * (bBoosting ? 1.6f : 1.f) * Dt;
	Velocity *= FMath::Exp(-(Wish.IsNearlyZero() ? 2.4f : 0.8f) * Dt);
	const float Speed = Velocity.Size();
	if (Speed > MaxSpeed)
	{
		Velocity *= FMath::FInterpTo(Speed, MaxSpeed, Dt, 4.f) / Speed;
	}

	MoveWithCollision(Dt);
	OrientBody(Dt);

	const float SpeedFrac = FMath::Clamp(Velocity.Size() / CruiseSpeed, 0.f, 2.f);
	for (int32 i = 0; i < SwimMaterials.Num(); ++i)
	{
		if (SwimMaterials[i])
		{
			SwimMaterials[i]->SetScalarParameterValue(TEXT("Amp"), BaseAmp[i] * (0.5f + 0.6f * SpeedFrac));
		}
	}
}

void AAquariumFishPawn::ReadPlayerInput(float Dt, FVector& OutWish, bool& bOutBoost)
{
	APlayerController* PC = Cast<APlayerController>(GetController());
	if (!PC)
	{
		return;
	}
	if (PC->WasInputKeyJustPressed(EKeys::Escape))
	{
		UKismetSystemLibrary::QuitGame(this, PC, EQuitPreference::Quit, false);
		return;
	}
	if (PC->WasInputKeyJustPressed(EKeys::F1))
	{
		bShowHelp = !bShowHelp;
	}
	if (PC->WasInputKeyJustPressed(EKeys::V) || PC->WasInputKeyJustPressed(EKeys::Gamepad_FaceButton_Top))
	{
		SetStreamView(!bStreamView);
	}
	// колесо мыши — камера ближе/дальше
	if (PC->WasInputKeyJustPressed(EKeys::MouseScrollUp))
	{
		Arm->TargetArmLength = FMath::Clamp(Arm->TargetArmLength - 30.f, 100.f, 700.f);
	}
	if (PC->WasInputKeyJustPressed(EKeys::MouseScrollDown))
	{
		Arm->TargetArmLength = FMath::Clamp(Arm->TargetArmLength + 30.f, 100.f, 700.f);
	}

	// взгляд: мышь и правый стик
	float MouseX = 0.f, MouseY = 0.f;
	PC->GetInputMouseDelta(MouseX, MouseY);
	FRotator Look = PC->GetControlRotation();
	Look.Yaw += MouseX * MouseSensitivity + PC->GetInputAnalogKeyState(EKeys::Gamepad_RightX) * 120.f * Dt;
	Look.Pitch = FMath::Clamp(FRotator::NormalizeAxis(Look.Pitch + MouseY * MouseSensitivity
		+ PC->GetInputAnalogKeyState(EKeys::Gamepad_RightY) * 90.f * Dt), -75.f, 75.f);
	Look.Roll = 0.f;
	PC->SetControlRotation(Look);

	auto Down = [PC](const FKey& Key) { return PC->IsInputKeyDown(Key) ? 1.f : 0.f; };
	const float Forward = FMath::Clamp(Down(EKeys::W) - Down(EKeys::S)
		+ PC->GetInputAnalogKeyState(EKeys::Gamepad_LeftY), -1.f, 1.f);
	const float Right = FMath::Clamp(Down(EKeys::D) - Down(EKeys::A)
		+ PC->GetInputAnalogKeyState(EKeys::Gamepad_LeftX), -1.f, 1.f);
	const float Up = FMath::Clamp(Down(EKeys::SpaceBar) + Down(EKeys::E) - Down(EKeys::LeftControl) - Down(EKeys::C)
		- Down(EKeys::Q) + PC->GetInputAnalogKeyState(EKeys::Gamepad_RightTriggerAxis)
		- PC->GetInputAnalogKeyState(EKeys::Gamepad_LeftTriggerAxis), -1.f, 1.f);

	const FRotationMatrix Axes(Look);
	OutWish = Axes.GetUnitAxis(EAxis::X) * Forward + Axes.GetUnitAxis(EAxis::Y) * Right + FVector::UpVector * Up;
	if (OutWish.SizeSquared() > 1.f)
	{
		OutWish.Normalize();
	}
	bOutBoost = PC->IsInputKeyDown(EKeys::LeftShift) || PC->IsInputKeyDown(EKeys::Gamepad_FaceButton_Bottom)
		|| PC->IsInputKeyDown(EKeys::Gamepad_LeftShoulder);
}

void AAquariumFishPawn::RunAutopilot(float Dt, FVector& OutWish, bool& bOutBoost)
{
	AutopilotTime += Dt;
	const FVector Pos = GetActorLocation();
	const FVector FromCenter = Pos - AutopilotCenter;
	const float Angle = FMath::Atan2(FromCenter.Y, FromCenter.X) + 0.35f;
	const FVector Target = AutopilotCenter + FVector(FMath::Cos(Angle) * AutopilotRadius,
		FMath::Sin(Angle) * AutopilotRadius, 60.f * FMath::Sin(AutopilotTime * 0.3f));
	OutWish = (Target - Pos).GetSafeNormal();
	bOutBoost = FMath::Fmod(AutopilotTime, 12.f) < 2.f;

	if (APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		FRotator Look = OutWish.Rotation();
		Look.Pitch *= 0.5f;
		PC->SetControlRotation(FMath::RInterpTo(PC->GetControlRotation(), Look, Dt, 2.f));
		if (AutopilotShots < static_cast<int32>(UE_ARRAY_COUNT(AutopilotShotTimes))
			&& AutopilotTime > AutopilotShotTimes[AutopilotShots])
		{
			FScreenshotRequest::RequestScreenshot(FString::Printf(TEXT("autopilot_%d"), AutopilotShots), true, false);
			++AutopilotShots;
			// диагностика камеры: где пешка, где камера, упёрлась ли штанга
			FHitResult ArmHit;
			const FVector CamPos = Camera->GetComponentLocation();
			GetWorld()->LineTraceSingleByChannel(ArmHit, GetActorLocation(), Arm->GetUnfixedCameraPosition(), ECC_Camera,
				FCollisionQueryParams(SCENE_QUERY_STAT(AquariumArmProbe), false, this));
			UE_LOG(LogAquariumFish, Log, TEXT("Shot %d: pawn %s, camera %s (%.0f cm), arm fixed %d, blocked by %s"),
				AutopilotShots, *GetActorLocation().ToCompactString(), *CamPos.ToCompactString(),
				FVector::Dist(CamPos, GetActorLocation()), Arm->IsCollisionFixApplied(),
				ArmHit.bBlockingHit && ArmHit.GetActor() ? *ArmHit.GetActor()->GetName() : TEXT("nothing"));
		}
		if (AutopilotSeconds > 0.f && AutopilotTime > AutopilotSeconds)
		{
			UKismetSystemLibrary::QuitGame(this, PC, EQuitPreference::Quit, false);
		}
	}
}

void AAquariumFishPawn::MoveWithCollision(float Dt)
{
	const FVector Delta = Velocity * Dt;
	if (!Delta.IsNearlyZero())
	{
		FHitResult Hit;
		AddActorWorldOffset(Delta, true, &Hit);
		if (Hit.bBlockingHit)
		{
			if (Hit.bStartPenetrating && Hit.PenetrationDepth > 50.f)
			{
				// стоим глубоко внутри чего-то большого (например, коллизия, которой быть не должно):
				// не выталкиваться через полкарты — просто плыть дальше
				AddActorWorldOffset(Delta, false);
				UE_LOG(LogAquariumFish, Verbose, TEXT("Deep penetration in %s"), *GetNameSafe(Hit.GetActor()));
			}
			else if (Hit.bStartPenetrating)
			{
				AddActorWorldOffset(Hit.Normal * (Hit.PenetrationDepth + 0.5f), false);
			}
			else
			{
				// скольжение вдоль рифа
				const FVector Rest = Delta * (1.f - Hit.Time);
				AddActorWorldOffset(FVector::VectorPlaneProject(Rest, Hit.Normal), true);
			}
			Velocity = FVector::VectorPlaneProject(Velocity, Hit.Normal) * 0.8f;
		}
	}

	const FVector Pos = GetActorLocation();
	const FVector Inside = Pos.BoundToBox(BoundsMin, BoundsMax);
	if (!Inside.Equals(Pos))
	{
		SetActorLocation(Inside);
		for (int32 Axis = 0; Axis < 3; ++Axis)
		{
			if (Inside[Axis] != Pos[Axis])
			{
				Velocity[Axis] = 0.f;
			}
		}
	}
}

void AAquariumFishPawn::OrientBody(float Dt)
{
	const FRotator Current = GetActorRotation();
	FRotator Target(0.f, Current.Yaw, 0.f);
	if (Velocity.Size() > 15.f)
	{
		Target = Velocity.Rotation();
		Target.Pitch = FMath::Clamp(Target.Pitch, -55.f, 55.f);
		Target.Roll = 0.f;
	}
	FRotator Next = FMath::RInterpTo(FRotator(Current.Pitch, Current.Yaw, 0.f), Target, Dt, 3.5f);
	// крен в повороте: наклон в сторону поворота
	const float YawRate = FRotator::NormalizeAxis(Next.Yaw - Current.Yaw) / FMath::Max(Dt, 1e-3f);
	BankRoll = FMath::FInterpTo(BankRoll, FMath::Clamp(YawRate * 0.25f, -35.f, 35.f), Dt, 4.f);
	Next.Roll = BankRoll;
	SetActorRotation(Next);
}

void AAquariumFishPawn::Respawn()
{
	Velocity = FVector::ZeroVector;
	BoostEnergy = 1.f;
	FrozenTime = 1.f;
	SetActorTransform(SpawnTransform, false, nullptr, ETeleportType::TeleportPhysics);
	if (APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		PC->SetControlRotation(SpawnTransform.Rotator());
	}
}
