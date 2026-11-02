flowchart LR
    %% Actors
    Visitor((Visitor))
    Curator((Curator))

    %% System Boundary
    subgraph System [Browser-Based Photogrammetry & 3D Viewer]
        direction TB
        
        %% Visitor Use Cases
        UC1([Browse collection gallery])
        UC2([View object page])
        UC3([Interact with 3D model])
        UC4([Use measurement tools])
        UC5([Read annotations])
        
        %% Curator Use Cases
        UC6([Log in])
        UC7([Upload photographs])
        UC8([Monitor job status])
        UC9([Manage annotations])
        UC10([Adjust lighting controls])
        UC11([Publish 3D model])

        %% Relationships (Includes / Extends)
        UC2 -. "<< include >>" .-> UC3
        UC7 -. "<< include >>" .-> UC8
    end

    %% Actor to Use Case connections (Visitor)
    Visitor --- UC1
    Visitor --- UC2
    Visitor --- UC4
    Visitor --- UC5

    %% Actor to Use Case connections (Curator)
    Curator --- UC6
    Curator --- UC7
    Curator --- UC9
    Curator --- UC10
    Curator --- UC11
    
    %% Curator inherits visitor capabilities
    Curator --- UC1
    Curator --- UC2