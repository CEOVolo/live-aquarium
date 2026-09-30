#include "AquariumAmbience.h"

#include "AquariumTypes.h"
#include "Components/PrimitiveComponent.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"

DEFINE_LOG_CATEGORY_STATIC(LogAquariumAmbience, Log, All);

namespace
{
	// Сержант-майоры и клоуны: нос модели — локальная +Y (FISH_SPECIES в lt_common.py).
	const FVector SmallFishNoseLocal(0.f, 1.f, 0.f);
	constexpr float SchoolFleeRadius = 350.f;
	constexpr float ClownFleeRadius = 120.f;

	void MakeMovable(AActor* Actor)
	{
		TArray<AActor*> Parts;
		Actor->GetAttachedActors(Parts, true, true);
		Parts.Add(Actor);
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
	}

	FVector GroupCenter(AActor* Actor)
	{
		FVector Origin, Extent;
		Actor->GetActorBounds(false, Origin, Extent, true);
		return Origin;
	}
}

AAquariumAmbience::AAquariumAmbience()
{
	PrimaryActorTick.bCanEverTick = true;
}

void AAquariumAmbience::BeginPlay()
{
	Super::BeginPlay();
	for (TActorIterator<AActor> It(GetWorld()); It; ++It)
	{
		if (It->ActorHasTag(AquariumTags::Shark))
		{
			SharkActor = *It;
		}
	}
	// маршруты — как в build_sequence.py: большая стайка вокруг рифа, малая — у мозгового коралла
	AddSchool(AquariumTags::School0, FVector(794.f, -110.f, 205.f), FVector2D(420.f, 380.f), 40.f, false);
	AddSchool(AquariumTags::School1, FVector::ZeroVector, FVector2D(130.f, 100.f), 24.f, true);
	AddClowns();
	UE_LOG(LogAquariumAmbience, Log, TEXT("Ambient fish: %d, routes: %d"), Fish.Num(), Routes.Num());
}

FVector AAquariumAmbience::RoutePoint(const FRoute& Route, float T, FVector* OutVelocity) const
{
	const float W = 2.f * PI / Route.Period;
	const float Theta = Route.Theta0 + W * T;
	if (OutVelocity)
	{
		*OutVelocity = FVector(-Route.Radii.X * FMath::Sin(Theta) * W, Route.Radii.Y * FMath::Cos(Theta) * W,
			40.f * FMath::Cos(2.f * Theta) * W);
	}
	return Route.Center + FVector(Route.Radii.X * FMath::Cos(Theta), Route.Radii.Y * FMath::Sin(Theta),
		20.f * FMath::Sin(2.f * Theta));
}

void AAquariumAmbience::AddSchool(FName Tag, const FVector& Center, const FVector2D& Radii, float Period, bool bCenterOnGroup)
{
	TArray<AActor*> Roots;
	for (TActorIterator<AActor> It(GetWorld()); It; ++It)
	{
		if (It->ActorHasTag(Tag))
		{
			Roots.Add(*It);
		}
	}
	if (Roots.IsEmpty())
	{
		return;
	}
	TArray<FVector> Centers;
	FVector Centroid = FVector::ZeroVector;
	for (AActor* Root : Roots)
	{
		Centers.Add(GroupCenter(Root));
		Centroid += Centers.Last();
	}
	Centroid /= Roots.Num();

	FRoute Route;
	Route.Radii = Radii;
	Route.Period = Period;
	if (bCenterOnGroup)
	{
		Route.Center = Centroid - FVector(Radii.X, 0.f, 0.f);   // в начале стайка — в точке theta = 0
	}
	else
	{
		Route.Center = FVector(Center.X, Center.Y, Centroid.Z);
		Route.Theta0 = FMath::Atan2((Centroid.Y - Center.Y) / Radii.Y, (Centroid.X - Center.X) / Radii.X);
	}
	FVector StartVelocity;
	const FVector Start = RoutePoint(Route, 0.f, &StartVelocity);
	Route.StartHeading = FMath::RadiansToDegrees(FMath::Atan2(StartVelocity.Y, StartVelocity.X));
	const int32 RouteIndex = Routes.Add(Route);

	FRandomStream Rng(Tag.GetNumber() + Roots.Num() * 7919);
	for (int32 i = 0; i < Roots.Num(); ++i)
	{
		MakeMovable(Roots[i]);
		FFish& F = Fish.AddDefaulted_GetRef();
		F.Actor = Roots[i];
		F.LocalCenter = Roots[i]->GetActorTransform().InverseTransformPosition(Centers[i]);
		F.Offset = Centers[i] - Start;
		F.Phase = FVector(Rng.FRandRange(0.f, 2.f * PI), Rng.FRandRange(0.f, 2.f * PI), Rng.FRandRange(0.f, 2.f * PI));
		F.Wander = Rng.FRandRange(8.f, 16.f);
		F.LastPos = Centers[i];
		F.Heading = Roots[i]->GetActorTransform().TransformVectorNoScale(SmallFishNoseLocal);
		F.Route = RouteIndex;
	}
}

void AAquariumAmbience::AddClowns()
{
	FRandomStream Rng(7);
	for (TActorIterator<AActor> It(GetWorld()); It; ++It)
	{
		if (!It->ActorHasTag(AquariumTags::Clown))
		{
			continue;
		}
		MakeMovable(*It);
		const FVector Center = GroupCenter(*It);
		FFish& F = Fish.AddDefaulted_GetRef();
		F.Actor = *It;
		F.LocalCenter = It->GetActorTransform().InverseTransformPosition(Center);
		F.Offset = Center;
		F.Phase = FVector(Rng.FRandRange(0.f, 2.f * PI), Rng.RandRange(0, 1) == 0 ? 1.f : -1.f, 0.f);
		F.OrbitRadius = Rng.FRandRange(15.f, 25.f);
		F.OrbitPeriod = Rng.FRandRange(5.f, 9.f);
		F.LastPos = Center;
		F.Heading = It->GetActorTransform().TransformVectorNoScale(SmallFishNoseLocal);
	}
}

void AAquariumAmbience::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	const float Dt = FMath::Clamp(DeltaSeconds, 1e-3f, 0.1f);
	Time += Dt;

	TArray<FVector, TInlineAllocator<2>> Threats;
	if (const APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0))
	{
		Threats.Add(Player->GetActorLocation());
	}
	if (const AActor* Shark = SharkActor.Get())
	{
		Threats.Add(Shark->GetActorLocation());
	}

	for (FFish& F : Fish)
	{
		AActor* Actor = F.Actor.Get();
		if (!Actor)
		{
			continue;
		}
		FVector Target;
		float FleeRadius;
		if (F.Route >= 0)
		{
			const FRoute& Route = Routes[F.Route];
			FVector RouteVelocity;
			const FVector P = RoutePoint(Route, Time, &RouteVelocity);
			const float Heading = FMath::RadiansToDegrees(FMath::Atan2(RouteVelocity.Y, RouteVelocity.X));
			Target = P + F.Offset.RotateAngleAxis(Heading - Route.StartHeading, FVector::UpVector)
				+ FVector(F.Wander * FMath::Sin(0.8f * Time + F.Phase.X), F.Wander * FMath::Sin(0.6f * Time + F.Phase.Y),
					0.5f * F.Wander * FMath::Sin(0.9f * Time + F.Phase.Z));
			FleeRadius = SchoolFleeRadius;
		}
		else
		{
			const float Theta = F.Phase.X + F.Phase.Y * 2.f * PI / F.OrbitPeriod * Time;
			Target = F.Offset + FVector(F.OrbitRadius * FMath::Cos(Theta), 0.7f * F.OrbitRadius * FMath::Sin(Theta),
				6.f * FMath::Sin(1.7f * Theta));
			FleeRadius = ClownFleeRadius;
		}

		for (const FVector& Threat : Threats)
		{
			const FVector Away = Target + F.Flee - Threat;
			const float Dist = Away.Size();
			if (Dist < FleeRadius && Dist > 1.f)
			{
				F.Flee += Away / Dist * (FleeRadius - Dist) * 3.f * Dt;
			}
		}
		F.Flee *= FMath::Exp(-0.8f * Dt);

		const FVector Pos = Target + F.Flee;
		const FVector Velocity = (Pos - F.LastPos) / Dt;
		F.LastPos = Pos;
		if (Velocity.SizeSquared() > 4.f)
		{
			F.Heading = FMath::VInterpNormalRotationTo(F.Heading, Velocity.GetSafeNormal(), Dt, 300.f);
		}
		FVector Dir = F.Heading;
		Dir.Z = FMath::Clamp(Dir.Z, -0.5f, 0.5f);
		const FRotator Rot = AquariumMath::AimNose(Dir, SmallFishNoseLocal);
		Actor->SetActorLocationAndRotation(Pos - Rot.RotateVector(Actor->GetActorScale3D() * F.LocalCenter), Rot);
	}
}
