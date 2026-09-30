#include "AquariumShark.h"

#include "Animation/AnimSequence.h"
#include "AquariumFishPawn.h"
#include "AquariumGameMode.h"
#include "AquariumTypes.h"
#include "Components/SkeletalMeshComponent.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"

DEFINE_LOG_CATEGORY_STATIC(LogAquariumShark, Log, All);

namespace
{
	// Модель акулы: нос — локальная +Y; анимации — из импорта great_white.glb (import_fish.py).
	const FVector SharkNoseLocal(0.f, 1.f, 0.f);
	const TCHAR* SwimAnimPath = TEXT("/Game/LookTest/Fish/great_white/great_white/SkeletalMeshes/great_whiteswimming.great_whiteswimming");
	const TCHAR* BiteAnimPath = TEXT("/Game/LookTest/Fish/great_white/great_white/SkeletalMeshes/great_whitebite.great_whitebite");
	const FName JawBone(TEXT("Jaw_6"));

	// Патруль — эллипс вокруг рифа (см), скорости (см/с), повороты (град/с), дистанции (см).
	const FVector PatrolCenter(750.f, -50.f, 380.f);
	const FVector2D PatrolRadii(950.f, 800.f);
	constexpr float PatrolSpeed = 170.f;
	constexpr float ChaseSpeed = 360.f;
	constexpr float RetreatSpeed = 230.f;
	constexpr float PatrolTurn = 25.f;
	constexpr float ChaseTurn = 65.f;
	constexpr float SeeDistance = 1500.f;       // видит впереди
	constexpr float SenseDistance = 700.f;      // чует с любой стороны
	constexpr float LoseDistance = 2800.f;
	constexpr float ChaseTimeout = 22.f;
	constexpr float BiteDistance = 100.f;       // пасть — рыба
	constexpr float RetreatTime = 7.f;
	constexpr float MinPatrolTime = 2.f;
	constexpr float MinDepth = 140.f;
	constexpr float MaxDepth = 650.f;
}

AAquariumShark::AAquariumShark()
{
	PrimaryActorTick.bCanEverTick = true;
}

void AAquariumShark::BeginPlay()
{
	Super::BeginPlay();
	for (TActorIterator<AActor> It(GetWorld()); It; ++It)
	{
		if (It->ActorHasTag(AquariumTags::Shark))
		{
			SharkActor = *It;
			break;
		}
	}
	Mesh = SharkActor ? SharkActor->FindComponentByClass<USkeletalMeshComponent>() : nullptr;
	SwimAnim = LoadObject<UAnimSequence>(nullptr, SwimAnimPath);
	BiteAnim = LoadObject<UAnimSequence>(nullptr, BiteAnimPath);
	if (!SharkActor || !Mesh || !SwimAnim || !BiteAnim)
	{
		UE_LOG(LogAquariumShark, Warning, TEXT("Shark not ready: actor %d, mesh %d, swim %d, bite %d"),
			SharkActor != nullptr, Mesh != nullptr, SwimAnim != nullptr, BiteAnim != nullptr);
		SetActorTickEnabled(false);
		return;
	}
	Mesh->SetMobility(EComponentMobility::Movable);
	Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Mesh->SetAnimationMode(EAnimationMode::AnimationSingleNode);
	Mesh->PlayAnimation(SwimAnim, true);
	Heading = SharkActor->GetActorTransform().TransformVectorNoScale(SharkNoseLocal).GetSafeNormal();
	const FVector P = SharkActor->GetActorLocation() - PatrolCenter;
	PatrolAngle = FMath::Atan2(P.Y / PatrolRadii.Y, P.X / PatrolRadii.X);
}

FVector AAquariumShark::JawLocation() const
{
	return Mesh->GetSocketLocation(JawBone);
}

void AAquariumShark::SetState(EState NewState)
{
	const bool bWasBite = State == EState::Bite;
	State = NewState;
	StateTime = 0.f;
	bBitten = false;
	if (NewState == EState::Bite)
	{
		Mesh->PlayAnimation(BiteAnim, false);
		Mesh->SetPlayRate(1.f);
	}
	else if (bWasBite)
	{
		Mesh->PlayAnimation(SwimAnim, true);
	}
	if (NewState == EState::Patrol)
	{
		const FVector P = SharkActor->GetActorLocation() - PatrolCenter;
		PatrolAngle = FMath::Atan2(P.Y / PatrolRadii.Y, P.X / PatrolRadii.X);
	}
}

void AAquariumShark::Steer(const FVector& Desired, float TurnRateDeg, float Dt)
{
	FVector D = Desired.GetSafeNormal();
	if (D.IsNearlyZero())
	{
		return;
	}
	Heading = FMath::VInterpNormalRotationTo(Heading, D, Dt, TurnRateDeg);
	// без «свечек»: наклон не круче ~33°
	Heading.Z = FMath::Clamp(Heading.Z, -0.55f, 0.55f);
	Heading.Normalize();
}

void AAquariumShark::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	const float Dt = FMath::Min(DeltaSeconds, 0.1f);
	StateTime += Dt;

	AAquariumGameMode* Game = GetWorld()->GetAuthGameMode<AAquariumGameMode>();
	APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0);
	const FVector Pos = SharkActor->GetActorLocation();
	const FVector PlayerPos = Player ? Player->GetActorLocation() : Pos + FVector(1e6f);
	const float JawToPlayer = FVector::Dist(JawLocation(), PlayerPos);

	switch (State)
	{
	case EState::Patrol:
	{
		PatrolAngle += PatrolSpeed / (0.5f * (PatrolRadii.X + PatrolRadii.Y)) * Dt;
		const float A = PatrolAngle + 0.4f;   // целиться чуть вперёд по эллипсу
		const FVector Target = PatrolCenter + FVector(FMath::Cos(A) * PatrolRadii.X, FMath::Sin(A) * PatrolRadii.Y,
			40.f * FMath::Sin(2.f * PatrolAngle));
		Steer(Target - Pos, PatrolTurn, Dt);
		Speed = FMath::FInterpTo(Speed, PatrolSpeed, Dt, 1.f);
		if (Player && StateTime > MinPatrolTime)
		{
			const FVector ToPlayer = PlayerPos - Pos;
			const float Dist = ToPlayer.Size();
			const bool bAhead = FVector::DotProduct(Heading, ToPlayer / FMath::Max(Dist, 1.f)) > -0.2f;
			if ((Dist < SeeDistance && bAhead) || Dist < SenseDistance)
			{
				SetState(EState::Chase);
			}
		}
		break;
	}
	case EState::Chase:
	{
		const AAquariumFishPawn* Fish = Cast<AAquariumFishPawn>(Player);
		const FVector Lead = PlayerPos + (Fish ? Fish->GetSwimVelocity() * 0.35f : FVector::ZeroVector);
		Steer(Lead - Pos, ChaseTurn, Dt);
		Speed = FMath::FInterpTo(Speed, ChaseSpeed, Dt, 1.5f);
		if (JawToPlayer < BiteDistance)
		{
			SetState(EState::Bite);
		}
		else if (StateTime > ChaseTimeout || FVector::Dist(Pos, PlayerPos) > LoseDistance)
		{
			SetState(EState::Retreat);
		}
		break;
	}
	case EState::Bite:
	{
		Steer(PlayerPos - Pos, 40.f, Dt);
		Speed = FMath::FInterpTo(Speed, 150.f, Dt, 3.f);
		if (!bBitten && StateTime > 0.3f)
		{
			bBitten = true;
			if (Game)
			{
				Game->OnPlayerCaught(Cast<AAquariumFishPawn>(Player));
			}
		}
		if (StateTime > BiteAnim->GetPlayLength())
		{
			SetState(EState::Retreat);
		}
		break;
	}
	case EState::Retreat:
	{
		FVector Away = Pos - PlayerPos;
		Away.Z = 0.f;
		Steer(Away.GetSafeNormal() + FVector(0.f, 0.f, 0.15f), 40.f, Dt);
		Speed = FMath::FInterpTo(Speed, RetreatSpeed, Dt, 1.f);
		if (StateTime > RetreatTime)
		{
			SetState(EState::Patrol);
		}
		break;
	}
	}

	// не зарываться в дно и не уплывать от рифа
	if (Pos.Z < MinDepth + 60.f)
	{
		Steer(Heading + FVector(0.f, 0.f, 0.6f), 90.f, Dt);
	}
	const FVector FromCenter = Pos - PatrolCenter;
	if (FVector2D(FromCenter.X, FromCenter.Y).Size() > 2200.f)
	{
		Steer(-FromCenter, 60.f, Dt);
	}

	FVector Next = Pos + Heading * Speed * Dt;
	Next.Z = FMath::Clamp(Next.Z, MinDepth, MaxDepth);
	SharkActor->SetActorLocationAndRotation(Next, AquariumMath::AimNose(Heading, SharkNoseLocal));
	if (State != EState::Bite)
	{
		Mesh->SetPlayRate(FMath::Clamp(Speed / 200.f, 0.7f, 1.8f));
	}

	if (Game)
	{
		Game->bSharkChasing = State == EState::Chase || State == EState::Bite;
		Game->SharkDistance = JawToPlayer;
	}
}
